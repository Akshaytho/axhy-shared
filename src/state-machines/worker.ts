/**
 * Worker Lifecycle state machine.
 * Owner: axhy-admin (authoritative) + axhy-v2-b2b (reads state, shows UI).
 */

export enum WorkerState {
  APPLICANT = "APPLICANT",
  SCREENING = "SCREENING",
  ONBOARDING = "ONBOARDING",
  PROBATION = "PROBATION",
  EXTENDED_PROBATION = "EXTENDED_PROBATION",
  ACTIVE = "ACTIVE",
  COACHING = "COACHING",
  ON_LEAVE = "ON_LEAVE",
  SUSPENDED_INVESTIGATION = "SUSPENDED_INVESTIGATION",
  ABSENT_UNAUTHORIZED = "ABSENT_UNAUTHORIZED",
  RESIGNING = "RESIGNING",
  TERMINATED = "TERMINATED",
  TERMINATED_PROBATION = "TERMINATED_PROBATION",
  DEPARTED = "DEPARTED",
  REJECTED_APPLICANT = "REJECTED_APPLICANT",
}

export const WORKER_TRANSITIONS: Readonly<Record<WorkerState, readonly WorkerState[]>> = {
  [WorkerState.APPLICANT]: [WorkerState.SCREENING, WorkerState.REJECTED_APPLICANT],
  [WorkerState.SCREENING]: [WorkerState.ONBOARDING, WorkerState.REJECTED_APPLICANT],
  [WorkerState.ONBOARDING]: [WorkerState.PROBATION],
  [WorkerState.PROBATION]: [
    WorkerState.ACTIVE,
    WorkerState.EXTENDED_PROBATION,
    WorkerState.TERMINATED_PROBATION,
  ],
  [WorkerState.EXTENDED_PROBATION]: [WorkerState.ACTIVE, WorkerState.TERMINATED_PROBATION],
  [WorkerState.ACTIVE]: [
    WorkerState.COACHING,
    WorkerState.ON_LEAVE,
    WorkerState.SUSPENDED_INVESTIGATION,
    WorkerState.RESIGNING,
  ],
  [WorkerState.COACHING]: [WorkerState.ACTIVE, WorkerState.TERMINATED],
  [WorkerState.ON_LEAVE]: [WorkerState.ACTIVE, WorkerState.ABSENT_UNAUTHORIZED],
  [WorkerState.ABSENT_UNAUTHORIZED]: [WorkerState.ACTIVE, WorkerState.TERMINATED],
  [WorkerState.SUSPENDED_INVESTIGATION]: [WorkerState.ACTIVE, WorkerState.TERMINATED],
  [WorkerState.RESIGNING]: [WorkerState.DEPARTED],
  [WorkerState.TERMINATED]: [WorkerState.DEPARTED],
  [WorkerState.TERMINATED_PROBATION]: [WorkerState.DEPARTED],
  [WorkerState.DEPARTED]: [WorkerState.ONBOARDING], // re-hire after 90+ days
  [WorkerState.REJECTED_APPLICANT]: [],
};

export function canTransitionWorker(from: WorkerState, to: WorkerState): boolean {
  if (from === to) return false;
  return WORKER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Worker states that block new visit assignments.
 * Used by DailyPlanner when generating visits.
 */
export const WORKER_UNAVAILABLE_STATES: ReadonlySet<WorkerState> = new Set<WorkerState>([
  WorkerState.APPLICANT,
  WorkerState.SCREENING,
  WorkerState.ONBOARDING,
  WorkerState.ON_LEAVE,
  WorkerState.SUSPENDED_INVESTIGATION,
  WorkerState.ABSENT_UNAUTHORIZED,
  WorkerState.RESIGNING,
  WorkerState.TERMINATED,
  WorkerState.TERMINATED_PROBATION,
  WorkerState.DEPARTED,
  WorkerState.REJECTED_APPLICANT,
]);

export function isWorkerAssignable(state: WorkerState): boolean {
  return !WORKER_UNAVAILABLE_STATES.has(state);
}
