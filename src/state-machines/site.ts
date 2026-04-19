/**
 * Site / Contract state machine. Client relationship lifecycle.
 * Owner: axhy-admin (exclusive).
 */

export enum SiteState {
  PROSPECT = "PROSPECT",
  ONBOARDING = "ONBOARDING",
  PROBATION = "PROBATION",
  STABLE = "STABLE",
  EARLY_RISK = "EARLY_RISK",
  AT_RISK = "AT_RISK",
  RENEWAL_WINDOW = "RENEWAL_WINDOW",
  CONTRACT_EXPANDED = "CONTRACT_EXPANDED",
  PAUSED = "PAUSED",
  CHURNING = "CHURNING",
  CANCELLED_EARLY = "CANCELLED_EARLY",
  CANCELLED_PROBATION = "CANCELLED_PROBATION",
  TERMINATED = "TERMINATED",
  LOST_SITE = "LOST_SITE",
}

export const SITE_TRANSITIONS: Readonly<Record<SiteState, readonly SiteState[]>> = {
  [SiteState.PROSPECT]: [SiteState.ONBOARDING, SiteState.LOST_SITE],
  [SiteState.ONBOARDING]: [SiteState.PROBATION, SiteState.CANCELLED_EARLY],
  [SiteState.PROBATION]: [
    SiteState.STABLE,
    SiteState.EARLY_RISK,
    SiteState.CANCELLED_PROBATION,
  ],
  [SiteState.EARLY_RISK]: [SiteState.STABLE, SiteState.CANCELLED_PROBATION],
  [SiteState.STABLE]: [
    SiteState.AT_RISK,
    SiteState.RENEWAL_WINDOW,
    SiteState.CONTRACT_EXPANDED,
    SiteState.PAUSED,
  ],
  [SiteState.AT_RISK]: [SiteState.STABLE, SiteState.CHURNING, SiteState.RENEWAL_WINDOW],
  [SiteState.RENEWAL_WINDOW]: [SiteState.STABLE, SiteState.CHURNING],
  [SiteState.CONTRACT_EXPANDED]: [SiteState.STABLE],
  [SiteState.PAUSED]: [SiteState.STABLE, SiteState.TERMINATED],
  [SiteState.CHURNING]: [SiteState.STABLE, SiteState.TERMINATED],
  [SiteState.CANCELLED_EARLY]: [],
  [SiteState.CANCELLED_PROBATION]: [],
  [SiteState.TERMINATED]: [SiteState.STABLE], // win-back
  [SiteState.LOST_SITE]: [],
};

export function canTransitionSite(from: SiteState, to: SiteState): boolean {
  if (from === to) return false;
  return SITE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Site states that allow ongoing visit generation. */
export const SITE_ACTIVE_STATES: ReadonlySet<SiteState> = new Set<SiteState>([
  SiteState.ONBOARDING,
  SiteState.PROBATION,
  SiteState.STABLE,
  SiteState.EARLY_RISK,
  SiteState.AT_RISK,
  SiteState.RENEWAL_WINDOW,
  SiteState.CONTRACT_EXPANDED,
]);

export function isSiteActive(state: SiteState): boolean {
  return SITE_ACTIVE_STATES.has(state);
}
