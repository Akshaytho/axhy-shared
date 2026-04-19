/**
 * SwapRequest state machine. Worker-to-worker assignment swaps.
 * Owner: axhy-admin (approval) + axhy-v2-b2b (submission).
 */

export enum SwapRequestState {
  DRAFT = "DRAFT",
  SUBMITTED = "SUBMITTED",
  PENDING_PARTNER = "PENDING_PARTNER",
  PENDING_ADMIN = "PENDING_ADMIN",
  PARTNER_ACCEPTED = "PARTNER_ACCEPTED",
  PARTNER_DECLINED = "PARTNER_DECLINED",
  PARTNER_TIMEOUT = "PARTNER_TIMEOUT",
  APPROVED_IMMEDIATE = "APPROVED_IMMEDIATE",
  APPROVED_PLANNED = "APPROVED_PLANNED",
  EXECUTED = "EXECUTED",
  EXECUTION_FAILED = "EXECUTION_FAILED",
  DENIED = "DENIED",
  CANCELLED = "CANCELLED",
  ABANDONED = "ABANDONED",
}

export const SWAP_REQUEST_TRANSITIONS: Readonly<
  Record<SwapRequestState, readonly SwapRequestState[]>
> = {
  [SwapRequestState.DRAFT]: [SwapRequestState.SUBMITTED, SwapRequestState.ABANDONED],
  [SwapRequestState.SUBMITTED]: [
    SwapRequestState.PENDING_PARTNER,
    SwapRequestState.PENDING_ADMIN,
  ],
  [SwapRequestState.PENDING_PARTNER]: [
    SwapRequestState.PARTNER_ACCEPTED,
    SwapRequestState.PARTNER_DECLINED,
    SwapRequestState.PARTNER_TIMEOUT,
  ],
  [SwapRequestState.PARTNER_ACCEPTED]: [SwapRequestState.PENDING_ADMIN],
  [SwapRequestState.PENDING_ADMIN]: [
    SwapRequestState.APPROVED_IMMEDIATE,
    SwapRequestState.APPROVED_PLANNED,
    SwapRequestState.DENIED,
  ],
  [SwapRequestState.APPROVED_IMMEDIATE]: [
    SwapRequestState.EXECUTED,
    SwapRequestState.EXECUTION_FAILED,
  ],
  [SwapRequestState.APPROVED_PLANNED]: [SwapRequestState.EXECUTED],
  [SwapRequestState.EXECUTION_FAILED]: [
    SwapRequestState.PENDING_ADMIN,
    SwapRequestState.CANCELLED,
  ],
  [SwapRequestState.PARTNER_DECLINED]: [],
  [SwapRequestState.PARTNER_TIMEOUT]: [],
  [SwapRequestState.EXECUTED]: [],
  [SwapRequestState.DENIED]: [],
  [SwapRequestState.CANCELLED]: [],
  [SwapRequestState.ABANDONED]: [],
};

export function canTransitionSwapRequest(from: SwapRequestState, to: SwapRequestState): boolean {
  if (from === to) return false;
  return SWAP_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}
