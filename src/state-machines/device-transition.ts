/**
 * transitionDevice() — the ONLY sanctioned path to mutate User.deviceState.
 *
 * Device machine is simpler than worker: no mandatory-metadata rules beyond
 * idempotency + valid-edge. The interesting transitions are driven by signals
 * (OFFLINE heartbeat miss, FLAKY upload-fail rate) which already live in
 * downstream worker services. This helper just enforces the closed edge set.
 */

import { DeviceState, DEVICE_TRANSITIONS } from "./device";
import {
  DeviceInvalidTransitionError,
  DeviceOwnerNotFoundError,
} from "./lifecycle-errors";
import { MissingIdempotencyKeyError } from "./visit-errors";
import { isUniqueConstraintError } from "./concurrency";

// ─── Actor ──────────────────────────────────────────────────────────────────

export enum DeviceActorType {
  SYSTEM = "SYSTEM",
  COMPANY_ADMIN = "COMPANY_ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
  WORKER = "WORKER",
}

export interface DeviceActor {
  type: DeviceActorType;
  id: string | null;
}

// ─── Tx interface ───────────────────────────────────────────────────────────

interface UserDeviceRow {
  id: string;
  deviceState: string | null;
}

interface DeviceEventRow {
  id: string;
  idempotencyKey: string | null;
  userId: string;
  eventType: string;
  payload: unknown;
  actorType: string;
  actorId: string | null;
  createdAt: Date | string;
}

export interface DeviceUserDelegate {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<UserDeviceRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<UserDeviceRow>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface DeviceLifecycleEventDelegate {
  findUnique(args: {
    where: { idempotencyKey: string };
  }): Promise<DeviceEventRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<DeviceEventRow>;
}

export interface DeviceTxClient {
  user: DeviceUserDelegate;
  deviceLifecycleEvent: DeviceLifecycleEventDelegate;
}

// ─── Input / result ─────────────────────────────────────────────────────────

export interface TransitionDeviceInput {
  userId: string;
  to: DeviceState;
  actor: DeviceActor;
  reason: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export type TransitionDeviceStatus = "transitioned" | "duplicate" | "no-op";

export interface TransitionDeviceResult {
  status: TransitionDeviceStatus;
  fromState: DeviceState;
  toState: DeviceState;
  eventId: string;
}

export const DEVICE_STATE_TRANSITION_EVENT_TYPE = "STATE_TRANSITION" as const;

// ─── Core ───────────────────────────────────────────────────────────────────

export async function transitionDevice(
  tx: DeviceTxClient,
  input: TransitionDeviceInput,
): Promise<TransitionDeviceResult> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new MissingIdempotencyKeyError();
  }

  const existing = await tx.deviceLifecycleEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    return {
      status: "duplicate",
      fromState: payload.from as DeviceState,
      toState: payload.to as DeviceState,
      eventId: existing.id,
    };
  }

  const row = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, deviceState: true },
  });
  if (!row) {
    throw new DeviceOwnerNotFoundError(input.userId);
  }

  const from = (row.deviceState ?? DeviceState.REGISTERED) as DeviceState;

  if (from === input.to) {
    return { status: "no-op", fromState: from, toState: input.to, eventId: "" };
  }

  const allowed = DEVICE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.to)) {
    throw new DeviceInvalidTransitionError(from, input.to, allowed);
  }

  // Sprint 10 hardening: concurrency-safe update
  const updateResult = await tx.user.updateMany({
    where: {
      id: input.userId,
      deviceState: row.deviceState === null ? null : (from as unknown as string),
    },
    data: { deviceState: input.to },
  });

  if (updateResult.count === 0) {
    const current = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, deviceState: true },
    });
    const newFrom = (current?.deviceState ?? DeviceState.REGISTERED) as DeviceState;
    if (newFrom === input.to) {
      return { status: "no-op", fromState: newFrom, toState: input.to, eventId: "" };
    }
    throw new DeviceInvalidTransitionError(
      newFrom,
      input.to,
      DEVICE_TRANSITIONS[newFrom] ?? [],
    );
  }

  try {
    const event = await tx.deviceLifecycleEvent.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        userId: input.userId,
        eventType: DEVICE_STATE_TRANSITION_EVENT_TYPE,
        payload: {
          from,
          to: input.to,
          reason: input.reason,
          ...(input.payload ?? {}),
        },
        actorType: input.actor.type,
        actorId: input.actor.id,
      },
    });

    return {
      status: "transitioned",
      fromState: from,
      toState: input.to,
      eventId: event.id,
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const existing = await tx.deviceLifecycleEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const existingPayload = (existing.payload ?? {}) as Record<string, unknown>;
        return {
          status: "duplicate",
          fromState: existingPayload.from as DeviceState,
          toState: existingPayload.to as DeviceState,
          eventId: existing.id,
        };
      }
    }
    throw err;
  }
}
