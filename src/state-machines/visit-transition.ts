/**
 * transitionVisit() — the ONLY sanctioned path to change SiteVisit.lifecycleStatus.
 *
 * Per LOCKED v1.1 state machine design. Enforces:
 *   - Only valid transitions per VISIT_TRANSITIONS map
 *   - Idempotency via assignment-event key (duplicate replays collapse to
 *     the original event; state is not touched twice)
 *   - Mandatory structured metadata for REJECTED transitions (rule 3 from
 *     the locked spec): rejectionReason + rejectionDetail required; fraudCaseId
 *     required if reason=FRAUD; complaintId required if
 *     reason=CLIENT_COMPLAINT_UPHELD
 *   - Restoration-mode flag (rule 4): when POST_COMPLAINT_REVIEW dismisses
 *     back to a COMPLETED_* state, postComplaintReviewed stays true and
 *     postComplaintOutcome is recorded
 *   - Atomic state + event write (caller MUST wrap in a transaction)
 *
 * The function is database-agnostic at compile time: it accepts a minimal
 * Prisma-like transaction client interface. Both axhy-admin and axhy-v2-b2b
 * backend call it with their own prisma instances.
 */

import { VisitState, VISIT_TRANSITIONS, isRestorationTransition, RejectionReason } from "./visit";
import {
  VisitInvalidTransitionError,
  VisitNotFoundError,
  MissingRejectionMetadataError,
  MissingFraudCaseError,
  MissingComplaintIdError,
  MissingIdempotencyKeyError,
} from "./visit-errors";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal Prisma-compatible tx client interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The subset of Prisma's `SiteVisit` delegate that transitionVisit uses.
 * Both eclean-admin and backend satisfy this shape via their generated
 * `@prisma/client`, so callers pass their own tx client unchanged.
 */
export interface SiteVisitDelegate {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<VisitRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<VisitRow>;
}

export interface AssignmentEventDelegate {
  findUnique(args: {
    where: { idempotencyKey: string };
  }): Promise<EventRow | null>;
  create(args: {
    data: Record<string, unknown>;
  }): Promise<EventRow>;
}

export interface VisitTxClient {
  siteVisit: SiteVisitDelegate;
  assignmentEvent: AssignmentEventDelegate;
}

interface VisitRow {
  id: string;
  lifecycleStatus: string;
  assignmentId: string;
  postComplaintReviewed?: boolean;
}

interface EventRow {
  id: string;
  idempotencyKey: string | null;
  assignmentId: string;
  eventType: string;
  /**
   * JSON payload as returned by Prisma. Prisma's JsonValue admits primitives,
   * arrays, and nested objects — we widen to `unknown` so real prisma clients
   * satisfy the interface, then narrow back to `Record<string, unknown>` via
   * a safe cast when we read our own writes (we only ever write objects).
   */
  payload: unknown;
  actorType: string;
  actorId: string | null;
  createdAt: Date | string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input / result types
// ─────────────────────────────────────────────────────────────────────────────

// VisitActorType is defined in ./visit.ts and re-exported via the barrel.
import type { VisitActorType } from "./visit";

export interface VisitActor {
  type: VisitActorType;
  /**
   * Stable id of the actor. May be null for SYSTEM actors (e.g. cron jobs
   * where no user row exists) or CLIENT actors when the client is
   * unauthenticated.
   */
  id: string | null;
}

export interface TransitionVisitInput {
  visitId: string;
  to: VisitState;
  actor: VisitActor;
  reason: string;
  /**
   * Deterministic key that collapses duplicate replays of the same logical
   * action (worker retry, timer reattempt, admin double-click). Build via
   * buildIdempotencyKey() from @axhy/shared/utils.
   */
  idempotencyKey: string;
  /**
   * Transition-specific metadata. Required shape depends on `to`:
   *   - REJECTED: rejectionReason (RejectionReason enum), rejectionDetail (string),
   *     and fraudCaseId or complaintId per reason
   *   - other transitions: free-form metadata written to AssignmentEvent.payload
   */
  payload?: Record<string, unknown>;
}

export type TransitionVisitStatus = "transitioned" | "duplicate" | "no-op";

export interface TransitionVisitResult {
  status: TransitionVisitStatus;
  fromState: VisitState;
  toState: VisitState;
  eventId: string;
  isRestoration: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every transitionVisit() emits AssignmentEvent.eventType='STATE_TRANSITION'
 * (the enum value added in migration 005_state_transition_event). The
 * specific state info lives in the payload:
 *   { from, to, reason, restorationMode, ...userPayload }
 *
 * This is intentionally one value, not STATE_TRANSITION_<state>. Postgres
 * enums can't accept arbitrary suffixes, and analytics groups by
 * payload.to which is equally efficient via a GIN index if needed.
 */
export const STATE_TRANSITION_EVENT_TYPE = 'STATE_TRANSITION' as const;

export function buildEventType(_to: VisitState): string {
  return STATE_TRANSITION_EVENT_TYPE;
}

// ─────────────────────────────────────────────────────────────────────────────
// The core function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transition a visit to a new state, atomically writing an AssignmentEvent
 * and (when applicable) the postComplaintReviewed / postComplaintOutcome
 * flags on SiteVisit.
 *
 * MUST be called inside a prisma.$transaction — the tx client is required
 * so state + event write succeed or fail together. Caller wraps with their
 * own prisma instance.
 *
 * @throws MissingIdempotencyKeyError       if input.idempotencyKey is empty
 * @throws VisitNotFoundError               if no row with input.visitId
 * @throws InvalidTransitionError           if from → to is not in the map
 * @throws MissingRejectionMetadataError    if REJECTED without reason/detail
 * @throws MissingFraudCaseError            if REJECTED+FRAUD without fraudCaseId
 * @throws MissingComplaintIdError          if REJECTED+COMPLAINT without complaintId
 */
export async function transitionVisit(
  tx: VisitTxClient,
  input: TransitionVisitInput,
): Promise<TransitionVisitResult> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new MissingIdempotencyKeyError();
  }

  // 1. Idempotency check — same key short-circuits to the existing event
  const existing = await tx.assignmentEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    return {
      status: "duplicate",
      fromState: payload.from as VisitState,
      toState: payload.to as VisitState,
      eventId: existing.id,
      isRestoration: payload.restorationMode === true,
    };
  }

  // 2. Load current state
  const visit = await tx.siteVisit.findUnique({
    where: { id: input.visitId },
    select: {
      id: true,
      lifecycleStatus: true,
      assignmentId: true,
      postComplaintReviewed: true,
    },
  });
  if (!visit) {
    throw new VisitNotFoundError(input.visitId);
  }

  const from = visit.lifecycleStatus as VisitState;

  // 3. No-op short-circuit — same state is not an error, just a replay we
  //    accept silently. Caller is expected to generate different
  //    idempotencyKeys for semantically distinct actions, so same-state
  //    transitions at different times shouldn't normally happen; when they
  //    do, we skip without writing another event.
  if (from === input.to) {
    return {
      status: "no-op",
      fromState: from,
      toState: input.to,
      eventId: "",
      isRestoration: false,
    };
  }

  // 4. Validate transition against the locked map
  const allowed = VISIT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.to)) {
    throw new VisitInvalidTransitionError(from, input.to, allowed);
  }

  // 5. Mandatory metadata enforcement for REJECTED transitions (rule 3)
  const payload = input.payload ?? {};
  if (input.to === VisitState.REJECTED) {
    const reason = payload.rejectionReason as string | undefined;
    if (!reason || !(reason in RejectionReason)) {
      throw new MissingRejectionMetadataError(
        "a valid RejectionReason enum value in payload.rejectionReason",
      );
    }
    const detail = payload.rejectionDetail as string | undefined;
    if (typeof detail !== "string" || detail.trim().length === 0) {
      throw new MissingRejectionMetadataError(
        "a non-empty payload.rejectionDetail describing the rejection",
      );
    }
    if (reason === RejectionReason.FRAUD && !payload.fraudCaseId) {
      throw new MissingFraudCaseError();
    }
    if (
      reason === RejectionReason.CLIENT_COMPLAINT_UPHELD &&
      !payload.complaintId
    ) {
      throw new MissingComplaintIdError();
    }
  }

  // 6. Detect restoration-mode and complaint-review accounting (rule 4)
  const isRestoration = isRestorationTransition(from, input.to);
  const enteringReview = input.to === VisitState.POST_COMPLAINT_REVIEW;
  const upheldAfterReview =
    from === VisitState.POST_COMPLAINT_REVIEW && input.to === VisitState.REJECTED;

  // 7. Write state — all relevant flags set in one update
  const updateData: Record<string, unknown> = {
    lifecycleStatus: input.to,
    updatedAt: new Date(),
  };
  if (enteringReview || isRestoration) {
    updateData.postComplaintReviewed = true;
  }
  if (isRestoration) {
    updateData.postComplaintOutcome = "DISMISSED";
  } else if (upheldAfterReview) {
    updateData.postComplaintOutcome = "UPHELD";
  }

  await tx.siteVisit.update({
    where: { id: input.visitId },
    data: updateData,
  });

  // 8. Write event — idempotencyKey unique index prevents duplicates
  const event = await tx.assignmentEvent.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      assignmentId: visit.assignmentId,
      eventType: buildEventType(input.to),
      payload: {
        from,
        to: input.to,
        reason: input.reason,
        restorationMode: isRestoration,
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
    isRestoration,
  };
}
