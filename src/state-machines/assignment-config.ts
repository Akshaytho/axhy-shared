/**
 * Assignment Config state machine — the recurring schedule slot.
 * Owner: axhy-admin (server only).
 */

export enum AssignmentConfigState {
  DRAFT = "DRAFT",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  WORKER_ON_LEAVE = "WORKER_ON_LEAVE",
  WORKER_DEPARTED = "WORKER_DEPARTED",
  SITE_PAUSED = "SITE_PAUSED",
  REASSIGNMENT_NEEDED = "REASSIGNMENT_NEEDED",
  INACTIVE = "INACTIVE",
  DISCARDED = "DISCARDED",
}

export const ASSIGNMENT_CONFIG_TRANSITIONS: Readonly<
  Record<AssignmentConfigState, readonly AssignmentConfigState[]>
> = {
  [AssignmentConfigState.DRAFT]: [AssignmentConfigState.ACTIVE, AssignmentConfigState.DISCARDED],
  [AssignmentConfigState.ACTIVE]: [
    AssignmentConfigState.PAUSED,
    AssignmentConfigState.WORKER_ON_LEAVE,
    AssignmentConfigState.WORKER_DEPARTED,
    AssignmentConfigState.SITE_PAUSED,
    AssignmentConfigState.INACTIVE,
  ],
  [AssignmentConfigState.PAUSED]: [AssignmentConfigState.ACTIVE],
  [AssignmentConfigState.WORKER_ON_LEAVE]: [
    AssignmentConfigState.ACTIVE,
    AssignmentConfigState.REASSIGNMENT_NEEDED,
  ],
  [AssignmentConfigState.WORKER_DEPARTED]: [AssignmentConfigState.REASSIGNMENT_NEEDED],
  [AssignmentConfigState.SITE_PAUSED]: [AssignmentConfigState.ACTIVE],
  [AssignmentConfigState.REASSIGNMENT_NEEDED]: [
    AssignmentConfigState.ACTIVE,
    AssignmentConfigState.INACTIVE,
  ],
  [AssignmentConfigState.INACTIVE]: [AssignmentConfigState.ACTIVE],
  [AssignmentConfigState.DISCARDED]: [],
};

export function canTransitionAssignmentConfig(
  from: AssignmentConfigState,
  to: AssignmentConfigState,
): boolean {
  if (from === to) return false;
  return ASSIGNMENT_CONFIG_TRANSITIONS[from]?.includes(to) ?? false;
}
