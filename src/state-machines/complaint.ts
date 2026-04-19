/**
 * Complaint state machine. Structured client complaint resolution.
 * Owner: axhy-admin (v2 feature).
 */

export enum ComplaintState {
  RECEIVED = "RECEIVED",
  TRIAGED = "TRIAGED",
  INVESTIGATING = "INVESTIGATING",
  EVIDENCE_GATHERED = "EVIDENCE_GATHERED",
  VALIDATED = "VALIDATED",
  REFUTED = "REFUTED",
  ACTION_PLANNED = "ACTION_PLANNED",
  RESOLVING = "RESOLVING",
  RESOLVED_ACKNOWLEDGED = "RESOLVED_ACKNOWLEDGED",
  RESOLVED_FORCED = "RESOLVED_FORCED",
  ESCALATED = "ESCALATED",
  CONTRACT_AT_RISK = "CONTRACT_AT_RISK",
  CHURN_TRIGGERED = "CHURN_TRIGGERED",
  CLIENT_UPDATED_REFUTED = "CLIENT_UPDATED_REFUTED",
  CLOSED_NO_FAULT = "CLOSED_NO_FAULT",
  CLOSED_RESOLVED = "CLOSED_RESOLVED",
  DISMISSED_DUPLICATE = "DISMISSED_DUPLICATE",
  DISMISSED_NOT_US = "DISMISSED_NOT_US",
}

export const COMPLAINT_TRANSITIONS: Readonly<
  Record<ComplaintState, readonly ComplaintState[]>
> = {
  [ComplaintState.RECEIVED]: [ComplaintState.TRIAGED],
  [ComplaintState.TRIAGED]: [
    ComplaintState.INVESTIGATING,
    ComplaintState.DISMISSED_DUPLICATE,
    ComplaintState.DISMISSED_NOT_US,
  ],
  [ComplaintState.INVESTIGATING]: [ComplaintState.EVIDENCE_GATHERED],
  [ComplaintState.EVIDENCE_GATHERED]: [ComplaintState.VALIDATED, ComplaintState.REFUTED],
  [ComplaintState.VALIDATED]: [ComplaintState.ACTION_PLANNED],
  [ComplaintState.REFUTED]: [ComplaintState.CLIENT_UPDATED_REFUTED],
  [ComplaintState.ACTION_PLANNED]: [ComplaintState.RESOLVING],
  [ComplaintState.RESOLVING]: [
    ComplaintState.RESOLVED_ACKNOWLEDGED,
    ComplaintState.RESOLVED_FORCED,
    ComplaintState.ESCALATED,
  ],
  [ComplaintState.ESCALATED]: [
    ComplaintState.RESOLVING,
    ComplaintState.CONTRACT_AT_RISK,
  ],
  [ComplaintState.CONTRACT_AT_RISK]: [
    ComplaintState.RESOLVED_ACKNOWLEDGED,
    ComplaintState.CHURN_TRIGGERED,
  ],
  [ComplaintState.CLIENT_UPDATED_REFUTED]: [ComplaintState.CLOSED_NO_FAULT],
  [ComplaintState.RESOLVED_ACKNOWLEDGED]: [ComplaintState.CLOSED_RESOLVED],
  [ComplaintState.RESOLVED_FORCED]: [ComplaintState.CLOSED_RESOLVED],
  [ComplaintState.CHURN_TRIGGERED]: [],
  [ComplaintState.CLOSED_NO_FAULT]: [],
  [ComplaintState.CLOSED_RESOLVED]: [],
  [ComplaintState.DISMISSED_DUPLICATE]: [],
  [ComplaintState.DISMISSED_NOT_US]: [],
};

export function canTransitionComplaint(from: ComplaintState, to: ComplaintState): boolean {
  if (from === to) return false;
  return COMPLAINT_TRANSITIONS[from]?.includes(to) ?? false;
}
