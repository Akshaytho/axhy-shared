/**
 * Visit Execution State Machine — LOCKED v1.1
 *
 * 18 states. 26 valid transitions. Approved by final friend review (9.4/10).
 * Source of truth for both axhy-admin (server) and axhy-v2-b2b (client).
 *
 * DESIGN RULES (from the locked spec):
 *  1. Only reliable signals become states. Soft signals live in SoftSignal table.
 *  2. Review history lives in events, not new states.
 *  3. Rejection reason is metadata, not lifecycle branching.
 *  4. Complaint dismissal restores original terminal outcome (restorationMode flag).
 */

export enum VisitState {
  // Active / progression (11)
  SCHEDULED = "SCHEDULED",
  NOTIFIED = "NOTIFIED",
  NO_SHOW_SUSPECTED = "NO_SHOW_SUSPECTED",
  REPLACEMENT_REQUESTED = "REPLACEMENT_REQUESTED",
  CHECKED_IN = "CHECKED_IN",
  IN_PROGRESS = "IN_PROGRESS",
  SUBMITTED = "SUBMITTED",
  VERIFIED = "VERIFIED",
  PARTIAL = "PARTIAL",
  FLAGGED = "FLAGGED",
  POST_COMPLAINT_REVIEW = "POST_COMPLAINT_REVIEW",

  // Terminal (7)
  COMPLETED_VERIFIED = "COMPLETED_VERIFIED",
  COMPLETED_PARTIAL_APPROVED = "COMPLETED_PARTIAL_APPROVED",
  COMPLETED_FLAGGED_WAIVED = "COMPLETED_FLAGGED_WAIVED",
  HANDOFF_REPLACED = "HANDOFF_REPLACED",
  UNCOVERED = "UNCOVERED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
}

export enum RejectionReason {
  FRAUD = "FRAUD",
  QUALITY_UNACCEPTABLE = "QUALITY_UNACCEPTABLE",
  EVIDENCE_INSUFFICIENT = "EVIDENCE_INSUFFICIENT",
  WRONG_SITE = "WRONG_SITE",
  CLIENT_COMPLAINT_UPHELD = "CLIENT_COMPLAINT_UPHELD",
  POLICY_VIOLATION = "POLICY_VIOLATION",
  INCOMPLETE_WORK = "INCOMPLETE_WORK",
  TIME_WINDOW_MISSED = "TIME_WINDOW_MISSED",
  OTHER = "OTHER",
}

export enum VisitActorType {
  WORKER = "WORKER",
  ADMIN = "ADMIN",
  SUPERVISOR = "SUPERVISOR",
  SYSTEM = "SYSTEM",
  CLIENT = "CLIENT",
}

/**
 * VISIT_TRANSITIONS — the complete allowed-transition table.
 * Keys are source states. Values are arrays of valid destination states.
 * Any transition NOT in this map is invalid.
 */
export const VISIT_TRANSITIONS: Readonly<Record<VisitState, readonly VisitState[]>> = {
  [VisitState.SCHEDULED]: [VisitState.NOTIFIED, VisitState.CANCELLED],
  [VisitState.NOTIFIED]: [
    VisitState.CHECKED_IN,
    VisitState.NO_SHOW_SUSPECTED,
    VisitState.CANCELLED,
  ],
  [VisitState.NO_SHOW_SUSPECTED]: [VisitState.CHECKED_IN, VisitState.REPLACEMENT_REQUESTED],
  [VisitState.REPLACEMENT_REQUESTED]: [VisitState.HANDOFF_REPLACED, VisitState.UNCOVERED],
  [VisitState.CHECKED_IN]: [VisitState.IN_PROGRESS],
  [VisitState.IN_PROGRESS]: [VisitState.SUBMITTED],
  [VisitState.SUBMITTED]: [VisitState.VERIFIED, VisitState.PARTIAL, VisitState.FLAGGED],
  [VisitState.VERIFIED]: [VisitState.COMPLETED_VERIFIED],
  [VisitState.PARTIAL]: [VisitState.COMPLETED_PARTIAL_APPROVED],
  [VisitState.FLAGGED]: [VisitState.COMPLETED_FLAGGED_WAIVED, VisitState.REJECTED],
  [VisitState.COMPLETED_VERIFIED]: [VisitState.POST_COMPLAINT_REVIEW],
  [VisitState.COMPLETED_PARTIAL_APPROVED]: [VisitState.POST_COMPLAINT_REVIEW],
  [VisitState.COMPLETED_FLAGGED_WAIVED]: [VisitState.POST_COMPLAINT_REVIEW],
  [VisitState.POST_COMPLAINT_REVIEW]: [
    VisitState.COMPLETED_VERIFIED,
    VisitState.COMPLETED_PARTIAL_APPROVED,
    VisitState.COMPLETED_FLAGGED_WAIVED,
    VisitState.REJECTED,
  ],
  // Pure terminals (no outgoing)
  [VisitState.HANDOFF_REPLACED]: [],
  [VisitState.UNCOVERED]: [],
  [VisitState.REJECTED]: [],
  [VisitState.CANCELLED]: [],
};

/**
 * TERMINAL_STATES — the 7 terminal (non-transitioning) visit states.
 * Note: COMPLETED_* can re-enter active via POST_COMPLAINT_REVIEW.
 * Pure terminals (never re-open): HANDOFF_REPLACED, UNCOVERED, REJECTED, CANCELLED.
 */
export const TERMINAL_STATES: ReadonlySet<VisitState> = new Set<VisitState>([
  VisitState.COMPLETED_VERIFIED,
  VisitState.COMPLETED_PARTIAL_APPROVED,
  VisitState.COMPLETED_FLAGGED_WAIVED,
  VisitState.HANDOFF_REPLACED,
  VisitState.UNCOVERED,
  VisitState.REJECTED,
  VisitState.CANCELLED,
]);

/** Pure terminals: those that can never re-open under any circumstance. */
export const PURE_TERMINAL_STATES: ReadonlySet<VisitState> = new Set<VisitState>([
  VisitState.HANDOFF_REPLACED,
  VisitState.UNCOVERED,
  VisitState.REJECTED,
  VisitState.CANCELLED,
]);

/** Completed outcomes (can re-open via POST_COMPLAINT_REVIEW). */
export const COMPLETED_OUTCOME_STATES: ReadonlySet<VisitState> = new Set<VisitState>([
  VisitState.COMPLETED_VERIFIED,
  VisitState.COMPLETED_PARTIAL_APPROVED,
  VisitState.COMPLETED_FLAGGED_WAIVED,
]);

/** States that enable payroll (terminal with payment allowed). */
export const PAYROLL_ENABLED_STATES: ReadonlySet<VisitState> = new Set<VisitState>([
  VisitState.COMPLETED_VERIFIED,
  VisitState.COMPLETED_PARTIAL_APPROVED,
  VisitState.COMPLETED_FLAGGED_WAIVED,
]);

export function canTransition(from: VisitState, to: VisitState): boolean {
  if (from === to) return false; // self-transitions invalid (rule G)
  const allowed = VISIT_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function isTerminal(state: VisitState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isPureTerminal(state: VisitState): boolean {
  return PURE_TERMINAL_STATES.has(state);
}

export function isActive(state: VisitState): boolean {
  return !isTerminal(state);
}

export function isCompletedOutcome(state: VisitState): boolean {
  return COMPLETED_OUTCOME_STATES.has(state);
}

export function allowsPayroll(state: VisitState): boolean {
  return PAYROLL_ENABLED_STATES.has(state);
}

/**
 * Detects the semantic "restoration" transition from POST_COMPLAINT_REVIEW back
 * to the original completion state (T-23/T-24/T-25). Used by transitionVisit()
 * to set the postComplaintReviewed flag on SiteVisit.
 */
export function isRestorationTransition(from: VisitState, to: VisitState): boolean {
  return from === VisitState.POST_COMPLAINT_REVIEW && isCompletedOutcome(to);
}

/**
 * Transition IDs (T-01..T-26) keyed by [from, to] pair. Used for telemetry and
 * analytics so we can speak about transitions by name rather than by pair.
 */
export const TRANSITION_IDS: Record<string, string> = {
  "null->SCHEDULED": "T-01",
  "SCHEDULED->NOTIFIED": "T-02",
  "SCHEDULED->CANCELLED": "T-03",
  "NOTIFIED->CHECKED_IN": "T-04",
  "NOTIFIED->NO_SHOW_SUSPECTED": "T-05",
  "NOTIFIED->CANCELLED": "T-06",
  "NO_SHOW_SUSPECTED->CHECKED_IN": "T-07",
  "NO_SHOW_SUSPECTED->REPLACEMENT_REQUESTED": "T-08",
  "REPLACEMENT_REQUESTED->HANDOFF_REPLACED": "T-09",
  "REPLACEMENT_REQUESTED->UNCOVERED": "T-10",
  "CHECKED_IN->IN_PROGRESS": "T-11",
  "IN_PROGRESS->SUBMITTED": "T-12",
  "SUBMITTED->VERIFIED": "T-13",
  "SUBMITTED->PARTIAL": "T-14",
  "SUBMITTED->FLAGGED": "T-15",
  "VERIFIED->COMPLETED_VERIFIED": "T-16",
  "PARTIAL->COMPLETED_PARTIAL_APPROVED": "T-17",
  "FLAGGED->COMPLETED_FLAGGED_WAIVED": "T-18",
  "FLAGGED->REJECTED": "T-19",
  "COMPLETED_VERIFIED->POST_COMPLAINT_REVIEW": "T-20",
  "COMPLETED_PARTIAL_APPROVED->POST_COMPLAINT_REVIEW": "T-21",
  "COMPLETED_FLAGGED_WAIVED->POST_COMPLAINT_REVIEW": "T-22",
  "POST_COMPLAINT_REVIEW->COMPLETED_VERIFIED": "T-23",
  "POST_COMPLAINT_REVIEW->COMPLETED_PARTIAL_APPROVED": "T-24",
  "POST_COMPLAINT_REVIEW->COMPLETED_FLAGGED_WAIVED": "T-25",
  "POST_COMPLAINT_REVIEW->REJECTED": "T-26",
};

export function getTransitionId(from: VisitState | null, to: VisitState): string | null {
  const key = `${from ?? "null"}->${to}`;
  return TRANSITION_IDS[key] ?? null;
}
