/**
 * transitionAssignmentConfig() — the ONLY sanctioned path to mutate
 * Assignment.lifecycleState.
 *
 * Mandatory metadata rules (per locked design):
 *   - PAUSED:              payload.pauseReason
 *   - WORKER_ON_LEAVE:     payload.leaveRequestId
 *   - WORKER_DEPARTED:     payload.workerId (terminated worker)
 *   - SITE_PAUSED:         payload.siteId + payload.siteCauseEventId (site lifecycle event)
 *   - REASSIGNMENT_NEEDED: payload.trigger ('WORKER_DEPARTED' | 'WORKER_EXTENDED_LEAVE' | 'SITE_CHANGE')
 *   - DISCARDED:           payload.discardReason
 *   - INACTIVE:            payload.reason
 */

import {
  AssignmentConfigState,
  ASSIGNMENT_CONFIG_TRANSITIONS,
} from "./assignment-config";
import {
  AssignmentConfigInvalidTransitionError,
  AssignmentConfigNotFoundError,
  MissingAssignmentConfigMetadataError,
} from "./lifecycle-errors-v9";
import { MissingIdempotencyKeyError } from "./visit-errors";

// ─── Actor ──────────────────────────────────────────────────────────────────

export enum AssignmentConfigActorType {
  COMPANY_ADMIN = "COMPANY_ADMIN",
  SUPERVISOR = "SUPERVISOR",
  SUPER_ADMIN = "SUPER_ADMIN",
  SYSTEM = "SYSTEM",
}

export interface AssignmentConfigActor {
  type: AssignmentConfigActorType;
  id: string | null;
}

// ─── Tx interface ───────────────────────────────────────────────────────────

interface AssignmentRow {
  id: string;
  lifecycleState: string | null;
}

interface AssignmentConfigEventRow {
  id: string;
  idempotencyKey: string | null;
  assignmentId: string;
  eventType: string;
  payload: unknown;
  actorType: string;
  actorId: string | null;
  createdAt: Date | string;
}

export interface AssignmentDelegate {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<AssignmentRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<AssignmentRow>;
}

export interface AssignmentConfigEventDelegate {
  findUnique(args: {
    where: { idempotencyKey: string };
  }): Promise<AssignmentConfigEventRow | null>;
  create(args: {
    data: Record<string, unknown>;
  }): Promise<AssignmentConfigEventRow>;
}

export interface AssignmentConfigTxClient {
  assignment: AssignmentDelegate;
  assignmentConfigEvent: AssignmentConfigEventDelegate;
}

// ─── Input / result ─────────────────────────────────────────────────────────

export interface TransitionAssignmentConfigInput {
  assignmentId: string;
  to: AssignmentConfigState;
  actor: AssignmentConfigActor;
  reason: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export type TransitionAssignmentConfigStatus = "transitioned" | "duplicate" | "no-op";

export interface TransitionAssignmentConfigResult {
  status: TransitionAssignmentConfigStatus;
  fromState: AssignmentConfigState;
  toState: AssignmentConfigState;
  eventId: string;
}

export const ASSIGNMENT_CONFIG_STATE_TRANSITION_EVENT_TYPE = "STATE_TRANSITION" as const;

// ─── Core ───────────────────────────────────────────────────────────────────

export async function transitionAssignmentConfig(
  tx: AssignmentConfigTxClient,
  input: TransitionAssignmentConfigInput,
): Promise<TransitionAssignmentConfigResult> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new MissingIdempotencyKeyError();
  }

  const existing = await tx.assignmentConfigEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    return {
      status: "duplicate",
      fromState: payload.from as AssignmentConfigState,
      toState: payload.to as AssignmentConfigState,
      eventId: existing.id,
    };
  }

  const row = await tx.assignment.findUnique({
    where: { id: input.assignmentId },
    select: { id: true, lifecycleState: true },
  });
  if (!row) {
    throw new AssignmentConfigNotFoundError(input.assignmentId);
  }

  // Null = legacy pre-backfill row; treat as DRAFT so the state machine
  // still works. New Assignment.create calls should seed DRAFT or ACTIVE.
  const from = (row.lifecycleState ?? AssignmentConfigState.DRAFT) as AssignmentConfigState;

  if (from === input.to) {
    return { status: "no-op", fromState: from, toState: input.to, eventId: "" };
  }

  const allowed = ASSIGNMENT_CONFIG_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.to)) {
    throw new AssignmentConfigInvalidTransitionError(from, input.to, allowed);
  }

  const payload = input.payload ?? {};
  validateAssignmentConfigMetadata(input.to, payload);

  await tx.assignment.update({
    where: { id: input.assignmentId },
    data: { lifecycleState: input.to },
  });

  const event = await tx.assignmentConfigEvent.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      assignmentId: input.assignmentId,
      eventType: ASSIGNMENT_CONFIG_STATE_TRANSITION_EVENT_TYPE,
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
}

function validateAssignmentConfigMetadata(
  to: AssignmentConfigState,
  payload: Record<string, unknown>,
): void {
  const requireStr = (key: string, desc: string): void => {
    const v = payload[key];
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new MissingAssignmentConfigMetadataError(`non-empty payload.${key} (${desc})`);
    }
  };

  switch (to) {
    case AssignmentConfigState.PAUSED:
      requireStr("pauseReason", "why this config is temporarily paused");
      break;
    case AssignmentConfigState.WORKER_ON_LEAVE:
      requireStr("leaveRequestId", "id of the LeaveRequest that triggered cascade");
      break;
    case AssignmentConfigState.WORKER_DEPARTED:
      requireStr("workerId", "id of the departed worker");
      break;
    case AssignmentConfigState.SITE_PAUSED:
      requireStr("siteId", "id of the paused site");
      requireStr("siteCauseEventId", "id of the Site lifecycle event that caused the pause");
      break;
    case AssignmentConfigState.REASSIGNMENT_NEEDED:
      requireStr(
        "trigger",
        "WORKER_DEPARTED | WORKER_EXTENDED_LEAVE | SITE_CHANGE | other",
      );
      break;
    case AssignmentConfigState.DISCARDED:
      requireStr("discardReason", "why this never-activated config is being discarded");
      break;
    case AssignmentConfigState.INACTIVE:
      requireStr("reason", "why this active config is being deactivated");
      break;
    default:
      break;
  }
}
