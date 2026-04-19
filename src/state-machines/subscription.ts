/**
 * Subscription state machine. Billing lifecycle per customer company.
 * Owner: axhy-admin (super-admin only in v1).
 */

export enum SubscriptionState {
  TRIAL = "TRIAL",
  ACTIVE = "ACTIVE",
  PAST_DUE = "PAST_DUE",
  GRACE = "GRACE",
  SUSPENDED_BILLING = "SUSPENDED_BILLING",
  CANCELLING = "CANCELLING",
  EXPIRED = "EXPIRED",
  TERMINATED = "TERMINATED",
}

export const SUBSCRIPTION_TRANSITIONS: Readonly<
  Record<SubscriptionState, readonly SubscriptionState[]>
> = {
  [SubscriptionState.TRIAL]: [SubscriptionState.ACTIVE, SubscriptionState.EXPIRED],
  [SubscriptionState.ACTIVE]: [SubscriptionState.PAST_DUE, SubscriptionState.CANCELLING],
  [SubscriptionState.PAST_DUE]: [SubscriptionState.ACTIVE, SubscriptionState.GRACE],
  [SubscriptionState.GRACE]: [SubscriptionState.ACTIVE, SubscriptionState.SUSPENDED_BILLING],
  [SubscriptionState.SUSPENDED_BILLING]: [
    SubscriptionState.ACTIVE,
    SubscriptionState.TERMINATED,
  ],
  [SubscriptionState.CANCELLING]: [SubscriptionState.TERMINATED, SubscriptionState.ACTIVE],
  [SubscriptionState.EXPIRED]: [SubscriptionState.ACTIVE, SubscriptionState.TERMINATED],
  [SubscriptionState.TERMINATED]: [SubscriptionState.ACTIVE], // win-back
};

export function canTransitionSubscription(
  from: SubscriptionState,
  to: SubscriptionState,
): boolean {
  if (from === to) return false;
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}
