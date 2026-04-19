/**
 * transitionSwapRequest() — the ONLY sanctioned path to mutate
 * SwapRequest.lifecycleState.
 *
 * Mirrors transitionVisit():
 *   - Only valid edges per SWAP_REQUEST_TRANSITIONS
 *   - Idempotency via SwapRequestEvent.idempotencyKey (unique partial index)
 *   - Atomic state update + event write (caller MUST wrap in $transaction)
 *   - Mandatory approval metadata on admin decisions
 *
 * Approval metadata rules (rule 3 of the swap machine):
 *   - APPROVED_IMMEDIATE | APPROVED_PLANNED: payload.approvedBy required
 *   - DENIED: payload.denialReason + payload.deniedBy required
 *   - EXECUTION_FAILED: payload.failureReason required (for post-mortem)
 */

import {
  SwapRequestState,
  SWAP_REQUEST_TRANSITIONS,
} from "./swap-request";
import {
  SwapRequestInvalidTransitionError,
  SwapRequestNotFoundError,
  MissingSwapAdminDecisionError,
} from "./lifecycle-errors";
import { MissingIdempotencyKeyError } from "./visit-errors";
import { isUniqueConstraintError } from "./concurrency";

// ─── Actor ──────────────────────────────────────────────────────────────────

export enum SwapActorType {
  WORKER = "WORKER",
  PARTNER_WORKER = "PARTNER_WORKER",
  SUPERVISOR = "SUPERVISOR",
  COMPANY_ADMIN = "COMPANY_ADMIN",
  SYSTEM = "SYSTEM",
}

export interface SwapActor {
  type: SwapActorType;
  id: string | null;
}

// ─── Minimal Prisma-compatible tx interface ─────────────────────────────────

interface SwapRow {
  id: string;
  lifecycleState: string | null;
}

interface SwapEventRow {
  id: string;
  idempotencyKey: string | null;
  swapRequestId: string;
  eventType: string;
  payload: unknown;
  actorType: string;
  actorId: string | null;
  createdAt: Date | string;
}

export interface SwapRequestDelegate {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<SwapRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<SwapRow>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface SwapRequestEventDelegate {
  findUnique(args: {
    where: { idempotencyKey: string };
  }): Promise<SwapEventRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<SwapEventRow>;
}

export interface SwapRequestTxClient {
  swapRequest: SwapRequestDelegate;
  swapRequestEvent: SwapRequestEventDelegate;
}

// ─── Input / result ─────────────────────────────────────────────────────────

export interface TransitionSwapRequestInput {
  swapRequestId: string;
  to: SwapRequestState;
  actor: SwapActor;
  reason: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export type TransitionSwapRequestStatus = "transitioned" | "duplicate" | "no-op";

export interface TransitionSwapRequestResult {
  status: TransitionSwapRequestStatus;
  fromState: SwapRequestState;
  toState: SwapRequestState;
  eventId: string;
}

// ─── Core ───────────────────────────────────────────────────────────────────

export const SWAP_STATE_TRANSITION_EVENT_TYPE = "STATE_TRANSITION" as const;

export async function transitionSwapRequest(
  tx: SwapRequestTxClient,
  input: TransitionSwapRequestInput,
): Promise<TransitionSwapRequestResult> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new MissingIdempotencyKeyError();
  }

  // 1. Idempotency short-circuit
  const existing = await tx.swapRequestEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    return {
      status: "duplicate",
      fromState: payload.from as SwapRequestState,
      toState: payload.to as SwapRequestState,
      eventId: existing.id,
    };
  }

  // 2. Load current state
  const row = await tx.swapRequest.findUnique({
    where: { id: input.swapRequestId },
    select: { id: true, lifecycleState: true },
  });
  if (!row) {
    throw new SwapRequestNotFoundError(input.swapRequestId);
  }

  // Null lifecycleState (legacy row pre-backfill) is treated as DRAFT for the
  // purposes of the state machine. Real callers should seed DRAFT at create
  // time after v1.6.0 ships.
  const from = (row.lifecycleState ?? SwapRequestState.DRAFT) as SwapRequestState;

  // 3. No-op short-circuit
  if (from === input.to) {
    return {
      status: "no-op",
      fromState: from,
      toState: input.to,
      eventId: "",
    };
  }

  // 4. Validate transition
  const allowed = SWAP_REQUEST_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.to)) {
    throw new SwapRequestInvalidTransitionError(from, input.to, allowed);
  }

  // 5. Mandatory metadata
  const payload = input.payload ?? {};
  if (
    input.to === SwapRequestState.APPROVED_IMMEDIATE ||
    input.to === SwapRequestState.APPROVED_PLANNED
  ) {
    if (!payload.approvedBy || typeof payload.approvedBy !== "string") {
      throw new MissingSwapAdminDecisionError(
        "payload.approvedBy (admin user id) on swap approval",
      );
    }
  }
  if (input.to === SwapRequestState.DENIED) {
    if (!payload.deniedBy || typeof payload.deniedBy !== "string") {
      throw new MissingSwapAdminDecisionError(
        "payload.deniedBy (admin user id) on swap denial",
      );
    }
    if (
      !payload.denialReason ||
      typeof payload.denialReason !== "string" ||
      payload.denialReason.trim().length === 0
    ) {
      throw new MissingSwapAdminDecisionError(
        "non-empty payload.denialReason explaining the denial",
      );
    }
  }
  if (input.to === SwapRequestState.EXECUTION_FAILED) {
    if (
      !payload.failureReason ||
      typeof payload.failureReason !== "string" ||
      payload.failureReason.trim().length === 0
    ) {
      throw new MissingSwapAdminDecisionError(
        "non-empty payload.failureReason for post-mortem on EXECUTION_FAILED",
      );
    }
  }

  // 6. Concurrency-safe update (Sprint 10 hardening)
  const updateResult = await tx.swapRequest.updateMany({
    where: {
      id: input.swapRequestId,
      // For legacy null rows that default to DRAFT, the WHERE needs to
      // match null explicitly — Prisma treats `undefined` as "skip" but
      // `null` as "equal to null". If the DB row still has null, only
      // null-matching queries find it.
      lifecycleState: row.lifecycleState === null ? null : (from as unknown as string),
    },
    data: { lifecycleState: input.to },
  });

  if (updateResult.count === 0) {
    const current = await tx.swapRequest.findUnique({
      where: { id: input.swapRequestId },
      select: { id: true, lifecycleState: true },
    });
    const newFrom = (current?.lifecycleState ?? SwapRequestState.DRAFT) as SwapRequestState;
    if (newFrom === input.to) {
      return {
        status: "no-op",
        fromState: newFrom,
        toState: input.to,
        eventId: "",
      };
    }
    throw new SwapRequestInvalidTransitionError(
      newFrom,
      input.to,
      SWAP_REQUEST_TRANSITIONS[newFrom] ?? [],
    );
  }

  try {
    const event = await tx.swapRequestEvent.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        swapRequestId: input.swapRequestId,
        eventType: SWAP_STATE_TRANSITION_EVENT_TYPE,
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
      const existing = await tx.swapRequestEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const existingPayload = (existing.payload ?? {}) as Record<string, unknown>;
        return {
          status: "duplicate",
          fromState: existingPayload.from as SwapRequestState,
          toState: existingPayload.to as SwapRequestState,
          eventId: existing.id,
        };
      }
    }
    throw err;
  }
}
