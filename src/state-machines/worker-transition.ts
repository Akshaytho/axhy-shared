/**
 * transitionWorker() — the ONLY sanctioned path to mutate
 * User.lifecycleState (worker lifecycle). Mirrors transitionVisit /
 * transitionSwapRequest.
 *
 * Mandatory metadata (per locked design doc §2.3):
 *   - TERMINATED | TERMINATED_PROBATION: payload.terminatedBy + payload.reason
 *   - SUSPENDED_INVESTIGATION:           payload.suspendedBy + payload.incidentId
 *   - COACHING:                          payload.coachingPlanId
 *   - REJECTED_APPLICANT:                payload.rejectionReason
 *
 * Re-hire is explicitly allowed (DEPARTED → ONBOARDING) but writes a fresh
 * probation window; caller is responsible for clearing out stale state
 * alongside transitionWorker() in the same tx.
 */

import { WorkerState, WORKER_TRANSITIONS } from "./worker";
import {
  WorkerInvalidTransitionError,
  WorkerNotFoundError,
  MissingWorkerDecisionMetadataError,
} from "./lifecycle-errors";
import { MissingIdempotencyKeyError } from "./visit-errors";
import { isUniqueConstraintError } from "./concurrency";

// ─── Actor ──────────────────────────────────────────────────────────────────

export enum WorkerActorType {
  SUPERVISOR = "SUPERVISOR",
  COMPANY_ADMIN = "COMPANY_ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
  SYSTEM = "SYSTEM",
  SELF = "SELF",
}

export interface WorkerActor {
  type: WorkerActorType;
  id: string | null;
}

// ─── Tx interface ───────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  lifecycleState: string | null;
}

interface WorkerEventRow {
  id: string;
  idempotencyKey: string | null;
  userId: string;
  eventType: string;
  payload: unknown;
  actorType: string;
  actorId: string | null;
  createdAt: Date | string;
}

export interface WorkerUserDelegate {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<UserRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<UserRow>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface WorkerLifecycleEventDelegate {
  findUnique(args: {
    where: { idempotencyKey: string };
  }): Promise<WorkerEventRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<WorkerEventRow>;
}

export interface WorkerTxClient {
  user: WorkerUserDelegate;
  workerLifecycleEvent: WorkerLifecycleEventDelegate;
}

// ─── Input / result ─────────────────────────────────────────────────────────

export interface TransitionWorkerInput {
  userId: string;
  to: WorkerState;
  actor: WorkerActor;
  reason: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export type TransitionWorkerStatus = "transitioned" | "duplicate" | "no-op";

export interface TransitionWorkerResult {
  status: TransitionWorkerStatus;
  fromState: WorkerState;
  toState: WorkerState;
  eventId: string;
}

export const WORKER_STATE_TRANSITION_EVENT_TYPE = "STATE_TRANSITION" as const;

// ─── Core ───────────────────────────────────────────────────────────────────

export async function transitionWorker(
  tx: WorkerTxClient,
  input: TransitionWorkerInput,
): Promise<TransitionWorkerResult> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new MissingIdempotencyKeyError();
  }

  const existing = await tx.workerLifecycleEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    return {
      status: "duplicate",
      fromState: payload.from as WorkerState,
      toState: payload.to as WorkerState,
      eventId: existing.id,
    };
  }

  const row = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, lifecycleState: true },
  });
  if (!row) {
    throw new WorkerNotFoundError(input.userId);
  }

  // Null = unseeded legacy user; default to APPLICANT so the whole machine
  // still works for backfilled rows. New code paths should always seed at
  // User.create time after v1.6.0 ships.
  const from = (row.lifecycleState ?? WorkerState.APPLICANT) as WorkerState;

  if (from === input.to) {
    return { status: "no-op", fromState: from, toState: input.to, eventId: "" };
  }

  const allowed = WORKER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.to)) {
    throw new WorkerInvalidTransitionError(from, input.to, allowed);
  }

  // Mandatory metadata
  const payload = input.payload ?? {};
  if (
    input.to === WorkerState.TERMINATED ||
    input.to === WorkerState.TERMINATED_PROBATION
  ) {
    if (!payload.terminatedBy || typeof payload.terminatedBy !== "string") {
      throw new MissingWorkerDecisionMetadataError(
        "payload.terminatedBy (admin/supervisor id) on termination",
      );
    }
    if (
      !payload.reason ||
      typeof payload.reason !== "string" ||
      payload.reason.trim().length === 0
    ) {
      throw new MissingWorkerDecisionMetadataError(
        "non-empty payload.reason on termination",
      );
    }
  }
  if (input.to === WorkerState.SUSPENDED_INVESTIGATION) {
    if (!payload.suspendedBy || typeof payload.suspendedBy !== "string") {
      throw new MissingWorkerDecisionMetadataError(
        "payload.suspendedBy on SUSPENDED_INVESTIGATION",
      );
    }
    if (!payload.incidentId || typeof payload.incidentId !== "string") {
      throw new MissingWorkerDecisionMetadataError(
        "payload.incidentId linking to the fraud/incident case",
      );
    }
  }
  if (input.to === WorkerState.COACHING) {
    if (!payload.coachingPlanId || typeof payload.coachingPlanId !== "string") {
      throw new MissingWorkerDecisionMetadataError(
        "payload.coachingPlanId referencing the coaching plan doc",
      );
    }
  }
  if (input.to === WorkerState.REJECTED_APPLICANT) {
    if (
      !payload.rejectionReason ||
      typeof payload.rejectionReason !== "string" ||
      payload.rejectionReason.trim().length === 0
    ) {
      throw new MissingWorkerDecisionMetadataError(
        "non-empty payload.rejectionReason on applicant rejection",
      );
    }
  }

  // Sprint 10 hardening: concurrency-safe update (from-state guard)
  const updateResult = await tx.user.updateMany({
    where: {
      id: input.userId,
      lifecycleState: row.lifecycleState === null ? null : (from as unknown as string),
    },
    data: { lifecycleState: input.to },
  });

  if (updateResult.count === 0) {
    const current = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, lifecycleState: true },
    });
    const newFrom = (current?.lifecycleState ?? WorkerState.APPLICANT) as WorkerState;
    if (newFrom === input.to) {
      return { status: "no-op", fromState: newFrom, toState: input.to, eventId: "" };
    }
    throw new WorkerInvalidTransitionError(
      newFrom,
      input.to,
      WORKER_TRANSITIONS[newFrom] ?? [],
    );
  }

  try {
    const event = await tx.workerLifecycleEvent.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        userId: input.userId,
        eventType: WORKER_STATE_TRANSITION_EVENT_TYPE,
        payload: {
          from,
          to: input.to,
          reason: input.reason,
          ...payload,
        },
        actorType: input.actor.type,
        actorId: input.actor.id,
      },
    });

    return {
      status: "transitioned",
      fromState: from,
      toState: input.to,
      eventId: event.id,
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const existing = await tx.workerLifecycleEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const existingPayload = (existing.payload ?? {}) as Record<string, unknown>;
        return {
          status: "duplicate",
          fromState: existingPayload.from as WorkerState,
          toState: existingPayload.to as WorkerState,
          eventId: existing.id,
        };
      }
    }
    throw err;
  }
}
