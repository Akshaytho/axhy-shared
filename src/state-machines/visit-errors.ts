/**
 * Error classes for the Visit state machine transitionVisit() function.
 *
 * Each error carries a stable `.code` string so callers can branch on it
 * without string-matching `.message`.
 */

import type { VisitState } from "./visit";

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(
    public readonly from: VisitState,
    public readonly to: VisitState,
    public readonly allowed: readonly VisitState[],
  ) {
    const allowedText = allowed.length ? allowed.join(", ") : "(terminal)";
    super(`Invalid visit transition: ${from} → ${to}. Allowed from ${from}: ${allowedText}`);
    this.name = "InvalidTransitionError";
  }
}

export class VisitNotFoundError extends Error {
  readonly code = "VISIT_NOT_FOUND";
  constructor(public readonly visitId: string) {
    super(`Visit ${visitId} not found`);
    this.name = "VisitNotFoundError";
  }
}

export class MissingRejectionMetadataError extends Error {
  readonly code = "MISSING_REJECTION_METADATA";
  constructor(missing: string) {
    super(`Transition to REJECTED requires ${missing}`);
    this.name = "MissingRejectionMetadataError";
  }
}

export class MissingFraudCaseError extends Error {
  readonly code = "MISSING_FRAUD_CASE";
  constructor() {
    super("Rejection with reason=FRAUD requires fraudCaseId in payload");
    this.name = "MissingFraudCaseError";
  }
}

export class MissingComplaintIdError extends Error {
  readonly code = "MISSING_COMPLAINT_ID";
  constructor() {
    super(
      "Rejection with reason=CLIENT_COMPLAINT_UPHELD requires complaintId in payload",
    );
    this.name = "MissingComplaintIdError";
  }
}

export class MissingIdempotencyKeyError extends Error {
  readonly code = "MISSING_IDEMPOTENCY_KEY";
  constructor() {
    super("transitionVisit() requires a non-empty idempotencyKey");
    this.name = "MissingIdempotencyKeyError";
  }
}
