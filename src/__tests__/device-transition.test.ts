/**
 * Tests for transitionDevice() — device lifecycle state machine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceState, DEVICE_TRANSITIONS } from "../state-machines/device";
import {
  transitionDevice,
  DeviceActorType,
} from "../state-machines/device-transition";
import type {
  DeviceTxClient,
  TransitionDeviceInput,
} from "../state-machines/device-transition";
import {
  DeviceInvalidTransitionError,
  DeviceOwnerNotFoundError,
} from "../state-machines/lifecycle-errors";
import { MissingIdempotencyKeyError } from "../state-machines/visit-errors";

interface MockRow {
  id: string;
  deviceState: string | null;
}

interface MockEventRow {
  id: string;
  idempotencyKey: string | null;
  userId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  actorType: string;
  actorId: string | null;
  createdAt: Date;
}

function makeTx(initialRows: MockRow[] = []) {
  const rows = new Map<string, MockRow>(initialRows.map((r) => [r.id, r]));
  const events = new Map<string, MockEventRow>();
  const eventsByIdempotency = new Map<string, MockEventRow>();
  let counter = 0;

  const tx: DeviceTxClient = {
    user: {
      async findUnique({ where }) {
        return rows.get(where.id) ?? null;
      },
      async update({ where, data }) {
        const r = rows.get(where.id);
        if (!r) throw new Error(`No user ${where.id}`);
        const updated = { ...r, ...(data as Partial<MockRow>) };
        rows.set(where.id, updated);
        return updated;
      },
      async updateMany({ where, data }) {
        const id = where.id as string;
        const fromGuard = where.deviceState as string | null | undefined;
        const r = rows.get(id);
        if (!r) return { count: 0 };
        if (fromGuard !== undefined && r.deviceState !== fromGuard) {
          return { count: 0 };
        }
        const updated = { ...r, ...(data as Partial<MockRow>) };
        rows.set(id, updated);
        return { count: 1 };
      },
    },
    deviceLifecycleEvent: {
      async findUnique({ where }) {
        return eventsByIdempotency.get(where.idempotencyKey) ?? null;
      },
      async create({ data }) {
        const id = `device-event-${++counter}`;
        const row: MockEventRow = {
          id,
          idempotencyKey: (data.idempotencyKey as string | null) ?? null,
          userId: data.userId as string,
          eventType: data.eventType as string,
          payload: (data.payload as Record<string, unknown> | null) ?? null,
          actorType: data.actorType as string,
          actorId: (data.actorId as string | null) ?? null,
          createdAt: new Date(),
        };
        events.set(id, row);
        if (row.idempotencyKey) {
          eventsByIdempotency.set(row.idempotencyKey, row);
        }
        return row;
      },
    },
  };
  return { tx, rows, events };
}

function seed(state: DeviceState | null): MockRow {
  return { id: "user-1", deviceState: state };
}

function baseInput(
  to: DeviceState,
  overrides: Partial<TransitionDeviceInput> = {},
): TransitionDeviceInput {
  return {
    userId: "user-1",
    to,
    actor: { type: DeviceActorType.SYSTEM, id: null },
    reason: "test",
    idempotencyKey: `idem-${to}-${Math.random()}`,
    ...overrides,
  };
}

// Happy-path: every edge in the canonical map
const happyPath: Array<{ from: DeviceState; to: DeviceState }> = [];
for (const [fromStr, targets] of Object.entries(DEVICE_TRANSITIONS)) {
  const from = fromStr as DeviceState;
  for (const to of targets) {
    happyPath.push({ from, to });
  }
}

for (const c of happyPath) {
  test(`device happy: ${c.from} → ${c.to}`, async () => {
    const { tx, rows, events } = makeTx([seed(c.from)]);
    const res = await transitionDevice(tx, baseInput(c.to));
    assert.equal(res.status, "transitioned");
    assert.equal(rows.get("user-1")?.deviceState, c.to);
    assert.equal(events.size, 1);
  });
}

// ─── Invalid transitions ────────────────────────────────────────────────────

test("device invalid: REGISTERED → ACTIVE (skip VERIFIED) rejects", async () => {
  const { tx } = makeTx([seed(DeviceState.REGISTERED)]);
  await assert.rejects(
    () => transitionDevice(tx, baseInput(DeviceState.ACTIVE)),
    (err) => err instanceof DeviceInvalidTransitionError,
  );
});

test("device invalid: BROKEN → ACTIVE (must go through REPLACED → VERIFIED) rejects", async () => {
  const { tx } = makeTx([seed(DeviceState.BROKEN)]);
  await assert.rejects(
    () => transitionDevice(tx, baseInput(DeviceState.ACTIVE)),
    (err) => err instanceof DeviceInvalidTransitionError,
  );
});

test("device invalid: WORKER_DEPARTED (terminal) → anything rejects", async () => {
  const { tx } = makeTx([seed(DeviceState.WORKER_DEPARTED)]);
  await assert.rejects(
    () => transitionDevice(tx, baseInput(DeviceState.REGISTERED)),
    (err) => err instanceof DeviceInvalidTransitionError,
  );
});

// ─── Recovery paths ─────────────────────────────────────────────────────────

test("recovery: BROKEN → REPLACED → VERIFIED → ACTIVE", async () => {
  const { tx, rows } = makeTx([seed(DeviceState.BROKEN)]);
  await transitionDevice(tx, baseInput(DeviceState.REPLACED));
  assert.equal(rows.get("user-1")?.deviceState, DeviceState.REPLACED);
  await transitionDevice(tx, baseInput(DeviceState.VERIFIED));
  assert.equal(rows.get("user-1")?.deviceState, DeviceState.VERIFIED);
  await transitionDevice(tx, baseInput(DeviceState.ACTIVE));
  assert.equal(rows.get("user-1")?.deviceState, DeviceState.ACTIVE);
});

test("recovery: FLAKY → ACTIVE", async () => {
  const { tx, rows } = makeTx([seed(DeviceState.FLAKY)]);
  await transitionDevice(tx, baseInput(DeviceState.ACTIVE));
  assert.equal(rows.get("user-1")?.deviceState, DeviceState.ACTIVE);
});

test("recovery: OFFLINE → ACTIVE", async () => {
  const { tx, rows } = makeTx([seed(DeviceState.OFFLINE)]);
  await transitionDevice(tx, baseInput(DeviceState.ACTIVE));
  assert.equal(rows.get("user-1")?.deviceState, DeviceState.ACTIVE);
});

test("re-register: UNINSTALLED → REGISTERED", async () => {
  const { tx, rows } = makeTx([seed(DeviceState.UNINSTALLED)]);
  await transitionDevice(tx, baseInput(DeviceState.REGISTERED));
  assert.equal(rows.get("user-1")?.deviceState, DeviceState.REGISTERED);
});

// ─── Idempotency ────────────────────────────────────────────────────────────

test("device idempotency: duplicate key = single event", async () => {
  const { tx, events } = makeTx([seed(DeviceState.REGISTERED)]);
  const input = baseInput(DeviceState.VERIFIED, { idempotencyKey: "stable" });
  await transitionDevice(tx, input);
  const r2 = await transitionDevice(tx, input);
  assert.equal(r2.status, "duplicate");
  assert.equal(events.size, 1);
});

test("device empty idempotencyKey rejects", async () => {
  const { tx } = makeTx([seed(DeviceState.REGISTERED)]);
  await assert.rejects(
    () => transitionDevice(tx, baseInput(DeviceState.VERIFIED, { idempotencyKey: "" })),
    (err) => err instanceof MissingIdempotencyKeyError,
  );
});

// ─── Not-found + null ──────────────────────────────────────────────────────

test("device not-found throws DeviceOwnerNotFoundError", async () => {
  const { tx } = makeTx([]);
  await assert.rejects(
    () => transitionDevice(tx, baseInput(DeviceState.VERIFIED)),
    (err) => err instanceof DeviceOwnerNotFoundError,
  );
});

test("null deviceState defaults to REGISTERED", async () => {
  const { tx, rows } = makeTx([seed(null)]);
  await transitionDevice(tx, baseInput(DeviceState.VERIFIED));
  assert.equal(rows.get("user-1")?.deviceState, DeviceState.VERIFIED);
});

// ─── No-op ──────────────────────────────────────────────────────────────────

test("device no-op: ACTIVE → ACTIVE writes no event", async () => {
  const { tx, events } = makeTx([seed(DeviceState.ACTIVE)]);
  const r = await transitionDevice(tx, baseInput(DeviceState.ACTIVE));
  assert.equal(r.status, "no-op");
  assert.equal(events.size, 0);
});

// ─── Payload shape ──────────────────────────────────────────────────────────

test("device event payload captures from/to/reason", async () => {
  const { tx, events } = makeTx([seed(DeviceState.ACTIVE)]);
  await transitionDevice(
    tx,
    baseInput(DeviceState.FLAKY, {
      reason: "high upload failure rate",
      payload: { failureRate: 0.37 },
      actor: { type: DeviceActorType.SYSTEM, id: null },
    }),
  );
  const [event] = [...events.values()];
  assert.ok(event);
  assert.equal(event.eventType, "STATE_TRANSITION");
  const payload = event.payload!;
  assert.equal(payload.from, DeviceState.ACTIVE);
  assert.equal(payload.to, DeviceState.FLAKY);
  assert.equal(payload.failureRate, 0.37);
});
