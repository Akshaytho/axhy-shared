/**
 * Company state machine. FM company lifecycle (v3 multi-tenant platform only).
 * Owner: axhy-admin super-admin.
 *
 * For single-company (current) operation this machine is dormant.
 */

export enum CompanyState {
  LEAD = "LEAD",
  ONBOARDING = "ONBOARDING",
  TRIAL = "TRIAL",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  SUSPENDED = "SUSPENDED",
  OFFBOARDING = "OFFBOARDING",
  CHURNED = "CHURNED",
  LOST = "LOST",
}

export const COMPANY_TRANSITIONS: Readonly<Record<CompanyState, readonly CompanyState[]>> = {
  [CompanyState.LEAD]: [CompanyState.ONBOARDING, CompanyState.LOST],
  [CompanyState.ONBOARDING]: [CompanyState.TRIAL, CompanyState.LOST],
  [CompanyState.TRIAL]: [CompanyState.ACTIVE, CompanyState.CHURNED],
  [CompanyState.ACTIVE]: [
    CompanyState.PAUSED,
    CompanyState.SUSPENDED,
    CompanyState.OFFBOARDING,
  ],
  [CompanyState.PAUSED]: [CompanyState.ACTIVE, CompanyState.CHURNED],
  [CompanyState.SUSPENDED]: [CompanyState.ACTIVE, CompanyState.CHURNED],
  [CompanyState.OFFBOARDING]: [CompanyState.CHURNED],
  [CompanyState.CHURNED]: [CompanyState.ACTIVE], // win-back
  [CompanyState.LOST]: [],
};

export function canTransitionCompany(from: CompanyState, to: CompanyState): boolean {
  if (from === to) return false;
  return COMPANY_TRANSITIONS[from]?.includes(to) ?? false;
}
