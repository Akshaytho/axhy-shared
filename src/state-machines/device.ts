/**
 * Worker Device state machine. Phone/SIM/app health per worker.
 * Owner: axhy-v2-b2b (primary) + axhy-admin (status display).
 */

export enum DeviceState {
  REGISTERED = "REGISTERED",
  VERIFIED = "VERIFIED",
  ACTIVE = "ACTIVE",
  FLAKY = "FLAKY",
  OFFLINE = "OFFLINE",
  BROKEN = "BROKEN",
  UNINSTALLED = "UNINSTALLED",
  REPLACED = "REPLACED",
  STALE = "STALE",
  WORKER_DEPARTED = "WORKER_DEPARTED",
}

export const DEVICE_TRANSITIONS: Readonly<Record<DeviceState, readonly DeviceState[]>> = {
  [DeviceState.REGISTERED]: [DeviceState.VERIFIED, DeviceState.STALE],
  [DeviceState.VERIFIED]: [DeviceState.ACTIVE],
  [DeviceState.ACTIVE]: [DeviceState.FLAKY, DeviceState.OFFLINE, DeviceState.UNINSTALLED],
  [DeviceState.FLAKY]: [DeviceState.ACTIVE, DeviceState.BROKEN],
  [DeviceState.OFFLINE]: [DeviceState.ACTIVE, DeviceState.BROKEN],
  [DeviceState.BROKEN]: [DeviceState.REPLACED, DeviceState.WORKER_DEPARTED],
  [DeviceState.REPLACED]: [DeviceState.VERIFIED],
  [DeviceState.STALE]: [DeviceState.VERIFIED],
  [DeviceState.UNINSTALLED]: [DeviceState.REGISTERED],
  [DeviceState.WORKER_DEPARTED]: [],
};

export function canTransitionDevice(from: DeviceState, to: DeviceState): boolean {
  if (from === to) return false;
  return DEVICE_TRANSITIONS[from]?.includes(to) ?? false;
}
