/**
 * Admin / Supervisor User state machine. Portal user lifecycle.
 * Owner: axhy-admin (exclusive).
 */

export enum AdminUserState {
  INVITED = "INVITED",
  INVITE_EXPIRED = "INVITE_EXPIRED",
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  PASSWORD_RESET = "PASSWORD_RESET",
  LOCKED = "LOCKED",
  OFFBOARDING = "OFFBOARDING",
  DEPARTED = "DEPARTED",
}

export const ADMIN_USER_TRANSITIONS: Readonly<
  Record<AdminUserState, readonly AdminUserState[]>
> = {
  [AdminUserState.INVITED]: [AdminUserState.ACTIVE, AdminUserState.INVITE_EXPIRED],
  [AdminUserState.INVITE_EXPIRED]: [AdminUserState.INVITED],
  [AdminUserState.ACTIVE]: [
    AdminUserState.INACTIVE,
    AdminUserState.PASSWORD_RESET,
    AdminUserState.LOCKED,
    AdminUserState.OFFBOARDING,
  ],
  [AdminUserState.INACTIVE]: [AdminUserState.ACTIVE, AdminUserState.OFFBOARDING],
  [AdminUserState.PASSWORD_RESET]: [AdminUserState.ACTIVE, AdminUserState.LOCKED],
  [AdminUserState.LOCKED]: [AdminUserState.ACTIVE, AdminUserState.OFFBOARDING],
  [AdminUserState.OFFBOARDING]: [AdminUserState.DEPARTED],
  [AdminUserState.DEPARTED]: [],
};

export function canTransitionAdminUser(from: AdminUserState, to: AdminUserState): boolean {
  if (from === to) return false;
  return ADMIN_USER_TRANSITIONS[from]?.includes(to) ?? false;
}
