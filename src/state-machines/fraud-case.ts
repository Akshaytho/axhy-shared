/**
 * FraudCase state machine. Formal fraud investigation with appeals.
 * Owner: axhy-admin (v2 feature).
 */

export enum FraudCaseState {
  TRIGGERED = "TRIGGERED",
  AUTO_CONFIRMED = "AUTO_CONFIRMED",
  HUMAN_REVIEW = "HUMAN_REVIEW",
  CLEARED = "CLEARED",
  WORKER_LOCKED = "WORKER_LOCKED",
  WORKER_CHALLENGED = "WORKER_CHALLENGED",
  EVIDENCE_REVIEW = "EVIDENCE_REVIEW",
  CLEARED_ON_APPEAL = "CLEARED_ON_APPEAL",
  CONFIRMED_VIOLATION = "CONFIRMED_VIOLATION",
  WARNING_ISSUED = "WARNING_ISSUED",
  TERMINATION_INITIATED = "TERMINATION_INITIATED",
  CRIMINAL_REFERRED = "CRIMINAL_REFERRED",
  WORKER_RESTORED = "WORKER_RESTORED",
  WORKER_RESTORED_WITH_RECORD = "WORKER_RESTORED_WITH_RECORD",
  PATTERN_LIBRARY_UPDATED = "PATTERN_LIBRARY_UPDATED",
}

export const FRAUD_CASE_TRANSITIONS: Readonly<
  Record<FraudCaseState, readonly FraudCaseState[]>
> = {
  [FraudCaseState.TRIGGERED]: [FraudCaseState.AUTO_CONFIRMED, FraudCaseState.HUMAN_REVIEW],
  [FraudCaseState.AUTO_CONFIRMED]: [FraudCaseState.WORKER_LOCKED],
  [FraudCaseState.HUMAN_REVIEW]: [FraudCaseState.WORKER_LOCKED, FraudCaseState.CLEARED],
  [FraudCaseState.CLEARED]: [FraudCaseState.PATTERN_LIBRARY_UPDATED],
  [FraudCaseState.WORKER_LOCKED]: [
    FraudCaseState.WORKER_CHALLENGED,
    FraudCaseState.CONFIRMED_VIOLATION,
  ],
  [FraudCaseState.WORKER_CHALLENGED]: [FraudCaseState.EVIDENCE_REVIEW],
  [FraudCaseState.EVIDENCE_REVIEW]: [
    FraudCaseState.CLEARED_ON_APPEAL,
    FraudCaseState.CONFIRMED_VIOLATION,
  ],
  [FraudCaseState.CLEARED_ON_APPEAL]: [FraudCaseState.WORKER_RESTORED],
  [FraudCaseState.CONFIRMED_VIOLATION]: [
    FraudCaseState.TERMINATION_INITIATED,
    FraudCaseState.WARNING_ISSUED,
    FraudCaseState.CRIMINAL_REFERRED,
  ],
  [FraudCaseState.WARNING_ISSUED]: [FraudCaseState.WORKER_RESTORED_WITH_RECORD],
  [FraudCaseState.TERMINATION_INITIATED]: [],
  [FraudCaseState.CRIMINAL_REFERRED]: [],
  [FraudCaseState.WORKER_RESTORED]: [],
  [FraudCaseState.WORKER_RESTORED_WITH_RECORD]: [],
  [FraudCaseState.PATTERN_LIBRARY_UPDATED]: [],
};

export function canTransitionFraudCase(from: FraudCaseState, to: FraudCaseState): boolean {
  if (from === to) return false;
  return FRAUD_CASE_TRANSITIONS[from]?.includes(to) ?? false;
}
