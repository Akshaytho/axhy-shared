/**
 * Tests for transitionAssignmentConfig() — AssignmentConfig lifecycle.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AssignmentConfigState,
  ASSIGNMENT_CONFIG_TRANSITIONS,
} from "../state-machines/assignment-config";
import {
  transitionAssignmentConfig,
  AssignmentConfigActorType,
} from "../state-machines/assignment-config-transition";
import type {
  AssignmentConfigTxClient,
  TransitionAssignmentConfigInput,
} from "../state-machines/assignment-config-transition";
import {
  AssignmentConfigInvalidTransitionError,
  AssignmentConfigNotFoundError,
  MissingAssignmentConfigMetadataError,
} from "../state-machines/lifecycle-errors-v9";
import { MissingIdempotencyKeyError } from "../state-machines/visit-errors";

interface MockAssignmentRow {
  id: string;
  lifecycleState: string | null;
}

interface MockEventRow {
  id: string;
  idempotencyKey: string | null;
  assignmentId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  actorType: string;
  actorId: string | null;
  createdAt: Date;
}

function makeTx(initialRows: MockAssignmentRow[] = []) {
  const rows = new Map<string, MockAssignmentRow>(initialRows.map((r) => [r.id, r]));
  const events = new Map<string, MockEventRow>();
  const eventsByIdempotency = new Map<string, MockEventRow>();
  let counter = 0;

  const tx: AssignmentConfigTxClient = {
    assignment: {
      async findUnique({ where }) {
        return rows.get(where.id) ?? null;
      },
      async update({ where, data }) {
        const r = rows.get(where.id);
        if (!r) throw new Error(`No assignment ${where.id}`);
        const updated = { ...r, ...(data as Partial<MockAssignmentRow>) };
        rows.set(where.id, updated);
        return updated;
      },
      async updateMany({ where, data }) {
        const id = where.id as string;
        const fromGuard = where.lifecycleState as string | null | undefined;
        const r = rows.get(id);
        if (!r) return { count: 0 };
        if (fromGuard !== undefined && r.lifecycleState !== fromGuard) {
          return { count: 0 };
        }
        const updated = { ...r, ...(data as Partial<MockAssignmentRow>) };
        rows.set(id, updated);
        return { count: 1 };
      },
    },
    assignmentConfigEvent: {
      async findUnique({ where }) {
        return eventsByIdempotency.get(where.idempotencyKey) ?? null;
      },
      async create({ data }) {
        const id = `ac-event-${++counter}`;
        const row: MockEventRow = {
          id,
          idempotencyKey: (data.idempotencyKey as string | null) ?? null,
          assignmentId: data.assignmentId as string,
          eventType: data.eventType as string,
          payload: (data.payload as Record<string, unknown> | null) ?? null,
          actorType: data.actorType as string,
          actorId: (data.actorId as string | null) ?? null,
          createdAt: new Date(),
        };
        events.set(id, row);
        if (row.idempotencyKey) eventsByIdempotency.set(row.idempotencyKey, row);
        return row;
      },
    },
  };
  return { tx, rows, events };
}

function seed(state: AssignmentConfigState | null): MockAssignmentRow {
  return { id: "asn-1", lifecycleState: state };
}

function baseInput(
  to: AssignmentConfigState,
  overrides: Partial<TransitionAssignmentConfigInput> = {},
): TransitionAssignmentConfigInput {
  return {
    assignmentId: "asn-1",
    to,
    actor: { type: AssignmentConfigActorType.SYSTEM, id: null },
    reason: "test",
    idempotencyKey: `idem-${to}-${Math.random()}`,
    ...overrides,
  };
}

// Build happy-path coverage automatically from the canonical map so any
// machine edit refreshes the test surface.
const happyPath: Array<{
  from: AssignmentConfigState;
  to: AssignmentConfigState;
  payload?: Record<string, unknown>;
}> = [];
for (const [fromStr, targets] of Object.entries(ASSIGNMENT_CONFIG_TRANSITIONS)) {
  const from = fromStr as AssignmentConfigState;
  for (const to of targets) {
    const payload: Record<string, unknown> | undefined = (() => {
      switch (to) {
        case AssignmentConfigState.PAUSED:
          return { pauseReason: "client requested temporary hold" };
        case AssignmentConfigState.WORKER_ON_LEAVE:
          return { leaveRequestId: "leave-1" };
        case AssignmentConfigState.WORKER_DEPARTED:
          return { workerId: "user-1" };
        case AssignmentConfigState.SITE_PAUSED:
          return { siteId: "site-1", siteCauseEventId: "site-evt-1" };
        case AssignmentConfigState.REASSIGNMENT_NEEDED:
          return { trigger: "WORKER_DEPARTED" };
        case AssignmentConfigState.DISCARDED:
          return { discardReason: "config never activated; superseded" };
        case AssignmentConfigState.INACTIVE:
          return { reason: "site contract terminated" };
        default:
          return undefined;
      }
    })();
    happyPath.push({ from, to, payload });
  }
}

for (const c of happyPath) {
  test(`assignment-config happy: ${c.from} → ${c.to}`, async () => {
    const { tx, rows, events } = makeTx([seed(c.from)]);
    const res = await transitionAssignmentConfig(
      tx,
      baseInput(c.to, { payload: c.payload }),
    );
    assert.equal(res.status, "transitioned");
    assert.equal(rows.get("asn-1")?.lifecycleState, c.to);
    assert.equal(events.size, 1);
  });
}

// ─── Invalid transitions ────────────────────────────────────────────────────

test("invalid: DRAFT → PAUSED (must activate first) rejects", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.DRAFT)]);
  await assert.rejects(
    () =>
      transitionAssignmentConfig(
        tx,
        baseInput(AssignmentConfigState.PAUSED, {
          payload: { pauseReason: "whatever" },
        }),
      ),
    (err) => err instanceof AssignmentConfigInvalidTransitionError,
  );
});

test("invalid: DISCARDED (terminal) → anything rejects", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.DISCARDED)]);
  await assert.rejects(
    () => transitionAssignmentConfig(tx, baseInput(AssignmentConfigState.ACTIVE)),
    (err) => err instanceof AssignmentConfigInvalidTransitionError,
  );
});

test("invalid: WORKER_DEPARTED → ACTIVE (must route through REASSIGNMENT_NEEDED) rejects", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.WORKER_DEPARTED)]);
  await assert.rejects(
    () => transitionAssignmentConfig(tx, baseInput(AssignmentConfigState.ACTIVE)),
    (err) => err instanceof AssignmentConfigInvalidTransitionError,
  );
});

// ─── Mandatory metadata ─────────────────────────────────────────────────────

test("PAUSED without pauseReason throws", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.ACTIVE)]);
  await assert.rejects(
    () => transitionAssignmentConfig(tx, baseInput(AssignmentConfigState.PAUSED)),
    (err) => err instanceof MissingAssignmentConfigMetadataError,
  );
});

test("WORKER_ON_LEAVE without leaveRequestId throws", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.ACTIVE)]);
  await assert.rejects(
    () =>
      transitionAssignmentConfig(tx, baseInput(AssignmentConfigState.WORKER_ON_LEAVE)),
    (err) => err instanceof MissingAssignmentConfigMetadataError,
  );
});

test("SITE_PAUSED requires both siteId and siteCauseEventId", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.ACTIVE)]);
  await assert.rejects(
    () =>
      transitionAssignmentConfig(
        tx,
        baseInput(AssignmentConfigState.SITE_PAUSED, {
          payload: { siteId: "site-1" }, // missing siteCauseEventId
        }),
      ),
    (err) => err instanceof MissingAssignmentConfigMetadataError,
  );
});

test("REASSIGNMENT_NEEDED without trigger throws", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.WORKER_DEPARTED)]);
  await assert.rejects(
    () =>
      transitionAssignmentConfig(
        tx,
        baseInput(AssignmentConfigState.REASSIGNMENT_NEEDED),
      ),
    (err) => err instanceof MissingAssignmentConfigMetadataError,
  );
});

// ─── Idempotency + no-op + not-found + null default ─────────────────────────

test("idempotency: duplicate key = single event", async () => {
  const { tx, events } = makeTx([seed(AssignmentConfigState.DRAFT)]);
  const input = baseInput(AssignmentConfigState.ACTIVE, { idempotencyKey: "stable" });
  await transitionAssignmentConfig(tx, input);
  const r2 = await transitionAssignmentConfig(tx, input);
  assert.equal(r2.status, "duplicate");
  assert.equal(events.size, 1);
});

test("empty idempotencyKey rejects", async () => {
  const { tx } = makeTx([seed(AssignmentConfigState.DRAFT)]);
  await assert.rejects(
    () =>
      transitionAssignmentConfig(
        tx,
        baseInput(AssignmentConfigState.ACTIVE, { idempotencyKey: "" }),
      ),
    (err) => err instanceof MissingIdempotencyKeyError,
  );
});

test("not-found throws AssignmentConfigNotFoundError", async () => {
  const { tx } = makeTx([]);
  await assert.rejects(
    () => transitionAssignmentConfig(tx, baseInput(AssignmentConfigState.ACTIVE)),
    (err) => err instanceof AssignmentConfigNotFoundError,
  );
});

test("null lifecycleState defaults to DRAFT", async () => {
  const { tx, rows } = makeTx([seed(null)]);
  const r = await transitionAssignmentConfig(
    tx,
    baseInput(AssignmentConfigState.ACTIVE),
  );
  assert.equal(r.fromState, AssignmentConfigState.DRAFT);
  assert.equal(rows.get("asn-1")?.lifecycleState, AssignmentConfigState.ACTIVE);
});

test("no-op: same state returns no-op + writes no event", async () => {
  const { tx, events } = makeTx([seed(AssignmentConfigState.ACTIVE)]);
  const r = await transitionAssignmentConfig(tx, baseInput(AssignmentConfigState.ACTIVE));
  assert.equal(r.status, "no-op");
  assert.equal(events.size, 0);
});

test("event payload preserves actor + metadata", async () => {
  const { tx, events } = makeTx([seed(AssignmentConfigState.ACTIVE)]);
  await transitionAssignmentConfig(
    tx,
    baseInput(AssignmentConfigState.PAUSED, {
      reason: "holiday hold",
      payload: { pauseReason: "festival week" },
      actor: { type: AssignmentConfigActorType.COMPANY_ADMIN, id: "admin-5" },
    }),
  );
  const [ev] = [...events.values()];
  assert.equal(ev.actorType, "COMPANY_ADMIN");
  assert.equal(ev.actorId, "admin-5");
  assert.equal((ev.payload as { pauseReason: string }).pauseReason, "festival week");
});
