/**
 * LeaveRequest state machine. Worker leave flow with cascading visit cancellations.
 * Owner: axhy-admin (approval) + axhy-v2-b2b (submission).
 */

export enum LeaveRequestState {
  SUBMITTED = "SUBMITTED",
  PENDING_APPROVAL = "PENDING_APPROVAL",
  AUTO_APPROVED = "AUTO_APPROVED",
  APPROVED = "APPROVED",
  CASCADED = "CASCADED",
  EXTENDED = "EXTENDED",
  DENIED = "DENIED",
  WORKER_WITHDREW = "WORKER_WITHDREW",
  COMPLETED = "COMPLETED",
  NO_SHOW_AFTER_LEAVE = "NO_SHOW_AFTER_LEAVE",
  ABSCONDED = "ABSCONDED",
  RETROACTIVELY_DENIED = "RETROACTIVELY_DENIED",
}

export const LEAVE_REQUEST_TRANSITIONS: Readonly<
  Record<LeaveRequestState, readonly LeaveRequestState[]>
> = {
  [LeaveRequestState.SUBMITTED]: [
    LeaveRequestState.PENDING_APPROVAL,
    LeaveRequestState.AUTO_APPROVED,
  ],
  [LeaveRequestState.PENDING_APPROVAL]: [
    LeaveRequestState.APPROVED,
    LeaveRequestState.DENIED,
    LeaveRequestState.WORKER_WITHDREW,
  ],
  [LeaveRequestState.AUTO_APPROVED]: [LeaveRequestState.APPROVED],
  [LeaveRequestState.APPROVED]: [
    LeaveRequestState.CASCADED,
    LeaveRequestState.RETROACTIVELY_DENIED,
  ],
  [LeaveRequestState.CASCADED]: [
    LeaveRequestState.COMPLETED,
    LeaveRequestState.EXTENDED,
    LeaveRequestState.NO_SHOW_AFTER_LEAVE,
  ],
  [LeaveRequestState.EXTENDED]: [LeaveRequestState.PENDING_APPROVAL],
  [LeaveRequestState.NO_SHOW_AFTER_LEAVE]: [
    LeaveRequestState.COMPLETED,
    LeaveRequestState.ABSCONDED,
  ],
  [LeaveRequestState.DENIED]: [],
  [LeaveRequestState.WORKER_WITHDREW]: [],
  [LeaveRequestState.COMPLETED]: [],
  [LeaveRequestState.ABSCONDED]: [],
  [LeaveRequestState.RETROACTIVELY_DENIED]: [],
};

export function canTransitionLeaveRequest(
  from: LeaveRequestState,
  to: LeaveRequestState,
): boolean {
  if (from === to) return false;
  return LEAVE_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}
