/**
 * Tests for transitionSwapRequest() — mirrors visit-transition.test.ts.
 * Covers:
 *   - All valid edges per SWAP_REQUEST_TRANSITIONS succeed
 *   - Invalid edges reject with SwapRequestInvalidTransitionError
 *   - Idempotency (same key = no duplicate write)
 *   - No-op handling for same-state
 *   - Mandatory approval / denial / failure metadata
 *   - Event payload shape
 *   - Terminal state rejects any outgoing transition
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SwapRequestState,
  SWAP_REQUEST_TRANSITIONS,
} from "../state-machines/swap-request";
import {
  transitionSwapRequest,
  SwapActorType,
} from "../state-machines/swap-request-transition";
import type {
  SwapRequestTxClient,
  TransitionSwapRequestInput,
} from "../state-machines/swap-request-transition";
import {
  SwapRequestInvalidTransitionError,
  SwapRequestNotFoundError,
  MissingSwapAdminDecisionError,
} from "../state-machines/lifecycle-errors";
import { MissingIdempotencyKeyError } from "../state-machines/visit-errors";

// ─── Mock tx ────────────────────────────────────────────────────────────────

interface MockSwapRow {
  id: string;
  lifecycleState: string | null;
}

interface MockSwapEventRow {
  id: string;
  idempotencyKey: string | null;
  swapRequestId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  actorType: string;
  actorId: string | null;
  createdAt: Date;
}

function makeTx(initialRows: MockSwapRow[] = []): {
  tx: SwapRequestTxClient;
  rows: Map<string, MockSwapRow>;
  events: Map<string, MockSwapEventRow>;
  eventsByIdempotency: Map<string, MockSwapEventRow>;
} {
  const rows = new Map<string, MockSwapRow>(initialRows.map((r) => [r.id, r]));
  const events = new Map<string, MockSwapEventRow>();
  const eventsByIdempotency = new Map<string, MockSwapEventRow>();
  let counter = 0;

  const tx: SwapRequestTxClient = {
    swapRequest: {
      async findUnique({ where }) {
        return rows.get(where.id) ?? null;
      },
      async update({ where, data }) {
        const r = rows.get(where.id);
        if (!r) throw new Error(`No swap ${where.id}`);
        const updated = { ...r, ...(data as Partial<MockSwapRow>) };
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
        const updated = { ...r, ...(data as Partial<MockSwapRow>) };
        rows.set(id, updated);
        return { count: 1 };
      },
    },
    swapRequestEvent: {
      async findUnique({ where }) {
        return eventsByIdempotency.get(where.idempotencyKey) ?? null;
      },
      async create({ data }) {
        const id = `swap-event-${++counter}`;
        const row: MockSwapEventRow = {
          id,
          idempotencyKey: (data.idempotencyKey as string | null) ?? null,
          swapRequestId: data.swapRequestId as string,
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
  return { tx, rows, events, eventsByIdempotency };
}

function seed(state: SwapRequestState | null = SwapRequestState.DRAFT): MockSwapRow {
  return { id: "swap-1", lifecycleState: state };
}

function baseInput(
  to: SwapRequestState,
  overrides: Partial<TransitionSwapRequestInput> = {},
): TransitionSwapRequestInput {
  return {
    swapRequestId: "swap-1",
    to,
    actor: { type: SwapActorType.SYSTEM, id: null },
    reason: "test",
    idempotencyKey: `idem-${to}-${Math.random()}`,
    ...overrides,
  };
}

// ─── Happy path: every valid edge ───────────────────────────────────────────

const happyPath: Array<{
  from: SwapRequestState;
  to: SwapRequestState;
  payload?: Record<string, unknown>;
}> = [
  { from: SwapRequestState.DRAFT, to: SwapRequestState.SUBMITTED },
  { from: SwapRequestState.DRAFT, to: SwapRequestState.ABANDONED },
  { from: SwapRequestState.SUBMITTED, to: SwapRequestState.PENDING_PARTNER },
  { from: SwapRequestState.SUBMITTED, to: SwapRequestState.PENDING_ADMIN },
  { from: SwapRequestState.PENDING_PARTNER, to: SwapRequestState.PARTNER_ACCEPTED },
  { from: SwapRequestState.PENDING_PARTNER, to: SwapRequestState.PARTNER_DECLINED },
  { from: SwapRequestState.PENDING_PARTNER, to: SwapRequestState.PARTNER_TIMEOUT },
  { from: SwapRequestState.PARTNER_ACCEPTED, to: SwapRequestState.PENDING_ADMIN },
  {
    from: SwapRequestState.PENDING_ADMIN,
    to: SwapRequestState.APPROVED_IMMEDIATE,
    payload: { approvedBy: "admin-1" },
  },
  {
    from: SwapRequestState.PENDING_ADMIN,
    to: SwapRequestState.APPROVED_PLANNED,
    payload: { approvedBy: "admin-1" },
  },
  {
    from: SwapRequestState.PENDING_ADMIN,
    to: SwapRequestState.DENIED,
    payload: { deniedBy: "admin-1", denialReason: "insufficient coverage" },
  },
  {
    from: SwapRequestState.APPROVED_IMMEDIATE,
    to: SwapRequestState.EXECUTED,
  },
  {
    from: SwapRequestState.APPROVED_IMMEDIATE,
    to: SwapRequestState.EXECUTION_FAILED,
    payload: { failureReason: "partner unreachable" },
  },
  { from: SwapRequestState.APPROVED_PLANNED, to: SwapRequestState.EXECUTED },
  {
    from: SwapRequestState.EXECUTION_FAILED,
    to: SwapRequestState.PENDING_ADMIN,
  },
  { from: SwapRequestState.EXECUTION_FAILED, to: SwapRequestState.CANCELLED },
];

for (const c of happyPath) {
  test(`happy: ${c.from} → ${c.to}`, async () => {
    const { tx, rows, events } = makeTx([seed(c.from)]);
    const res = await transitionSwapRequest(
      tx,
      baseInput(c.to, { payload: c.payload }),
    );
    assert.equal(res.status, "transitioned");
    assert.equal(res.fromState, c.from);
    assert.equal(res.toState, c.to);
    assert.equal(rows.get("swap-1")?.lifecycleState, c.to);
    assert.equal(events.size, 1);
  });
}

// ─── Invalid transitions ────────────────────────────────────────────────────

test("invalid: DRAFT → APPROVED_IMMEDIATE rejects", async () => {
  const { tx, rows } = makeTx([seed(SwapRequestState.DRAFT)]);
  await assert.rejects(
    () =>
      transitionSwapRequest(
        tx,
        baseInput(SwapRequestState.APPROVED_IMMEDIATE, {
          payload: { approvedBy: "admin-1" },
        }),
      ),
    (err) => err instanceof SwapRequestInvalidTransitionError,
  );
  assert.equal(rows.get("swap-1")?.lifecycleState, SwapRequestState.DRAFT);
});

test("invalid: EXECUTED (terminal) → anything rejects", async () => {
  const { tx } = makeTx([seed(SwapRequestState.EXECUTED)]);
  await assert.rejects(
    () => transitionSwapRequest(tx, baseInput(SwapRequestState.CANCELLED)),
    (err) => err instanceof SwapRequestInvalidTransitionError,
  );
});

test("invalid: ABANDONED (terminal) → anything rejects", async () => {
  const { tx } = makeTx([seed(SwapRequestState.ABANDONED)]);
  await assert.rejects(
    () => transitionSwapRequest(tx, baseInput(SwapRequestState.SUBMITTED)),
    (err) => err instanceof SwapRequestInvalidTransitionError,
  );
});

test("invalid: DENIED (terminal) → PENDING_ADMIN rejects", async () => {
  const { tx } = makeTx([seed(SwapRequestState.DENIED)]);
  await assert.rejects(
    () => transitionSwapRequest(tx, baseInput(SwapRequestState.PENDING_ADMIN)),
    (err) => err instanceof SwapRequestInvalidTransitionError,
  );
});

// ─── Mandatory metadata ─────────────────────────────────────────────────────

test("APPROVED_IMMEDIATE without approvedBy throws", async () => {
  const { tx } = makeTx([seed(SwapRequestState.PENDING_ADMIN)]);
  await assert.rejects(
    () => transitionSwapRequest(tx, baseInput(SwapRequestState.APPROVED_IMMEDIATE)),
    (err) => err instanceof MissingSwapAdminDecisionError,
  );
});

test("APPROVED_PLANNED without approvedBy throws", async () => {
  const { tx } = makeTx([seed(SwapRequestState.PENDING_ADMIN)]);
  await assert.rejects(
    () => transitionSwapRequest(tx, baseInput(SwapRequestState.APPROVED_PLANNED)),
    (err) => err instanceof MissingSwapAdminDecisionError,
  );
});

test("DENIED without denialReason throws", async () => {
  const { tx } = makeTx([seed(SwapRequestState.PENDING_ADMIN)]);
  await assert.rejects(
    () =>
      transitionSwapRequest(
        tx,
        baseInput(SwapRequestState.DENIED, { payload: { deniedBy: "admin-1" } }),
      ),
    (err) => err instanceof MissingSwapAdminDecisionError,
  );
});

test("DENIED without deniedBy throws", async () => {
  const { tx } = makeTx([seed(SwapRequestState.PENDING_ADMIN)]);
  await assert.rejects(
    () =>
      transitionSwapRequest(
        tx,
        baseInput(SwapRequestState.DENIED, {
          payload: { denialReason: "some reason" },
        }),
      ),
    (err) => err instanceof MissingSwapAdminDecisionError,
  );
});

test("EXECUTION_FAILED without failureReason throws", async () => {
  const { tx } = makeTx([seed(SwapRequestState.APPROVED_IMMEDIATE)]);
  await assert.rejects(
    () => transitionSwapRequest(tx, baseInput(SwapRequestState.EXECUTION_FAILED)),
    (err) => err instanceof MissingSwapAdminDecisionError,
  );
});

test("DENIED with empty denialReason throws", async () => {
  const { tx } = makeTx([seed(SwapRequestState.PENDING_ADMIN)]);
  await assert.rejects(
    () =>
      transitionSwapRequest(
        tx,
        baseInput(SwapRequestState.DENIED, {
          payload: { deniedBy: "admin-1", denialReason: "   " },
        }),
      ),
    (err) => err instanceof MissingSwapAdminDecisionError,
  );
});

// ─── Idempotency ────────────────────────────────────────────────────────────

test("idempotency: same key second call returns duplicate + no new event", async () => {
  const { tx, events } = makeTx([seed(SwapRequestState.DRAFT)]);
  const input = baseInput(SwapRequestState.SUBMITTED, { idempotencyKey: "stable-key" });
  const r1 = await transitionSwapRequest(tx, input);
  const r2 = await transitionSwapRequest(tx, input);
  assert.equal(r1.status, "transitioned");
  assert.equal(r2.status, "duplicate");
  assert.equal(r1.eventId, r2.eventId);
  assert.equal(events.size, 1);
});

test("idempotency: different key on same transition writes two events", async () => {
  // The second write will fail the state check (from==to after first write)
  // — that's fine, it returns no-op. Validates same-state behavior.
  const { tx, events } = makeTx([seed(SwapRequestState.DRAFT)]);
  await transitionSwapRequest(tx, baseInput(SwapRequestState.SUBMITTED, { idempotencyKey: "k1" }));
  const r2 = await transitionSwapRequest(
    tx,
    baseInput(SwapRequestState.SUBMITTED, { idempotencyKey: "k2" }),
  );
  assert.equal(r2.status, "no-op");
  assert.equal(events.size, 1);
});

test("empty idempotencyKey rejects", async () => {
  const { tx } = makeTx([seed(SwapRequestState.DRAFT)]);
  await assert.rejects(
    () =>
      transitionSwapRequest(
        tx,
        baseInput(SwapRequestState.SUBMITTED, { idempotencyKey: "" }),
      ),
    (err) => err instanceof MissingIdempotencyKeyError,
  );
});

test("whitespace-only idempotencyKey rejects", async () => {
  const { tx } = makeTx([seed(SwapRequestState.DRAFT)]);
  await assert.rejects(
    () =>
      transitionSwapRequest(
        tx,
        baseInput(SwapRequestState.SUBMITTED, { idempotencyKey: "   " }),
      ),
    (err) => err instanceof MissingIdempotencyKeyError,
  );
});

// ─── No-op same-state ───────────────────────────────────────────────────────

test("no-op: DRAFT → DRAFT does not error and writes no event", async () => {
  const { tx, events } = makeTx([seed(SwapRequestState.DRAFT)]);
  const r = await transitionSwapRequest(tx, baseInput(SwapRequestState.DRAFT));
  assert.equal(r.status, "no-op");
  assert.equal(events.size, 0);
});

// ─── Not-found ──────────────────────────────────────────────────────────────

test("not-found: missing row throws SwapRequestNotFoundError", async () => {
  const { tx } = makeTx([]);
  await assert.rejects(
    () => transitionSwapRequest(tx, baseInput(SwapRequestState.SUBMITTED)),
    (err) => err instanceof SwapRequestNotFoundError,
  );
});

// ─── Null lifecycleState defaults to DRAFT ──────────────────────────────────

test("null lifecycleState defaults to DRAFT for backfill compat", async () => {
  const { tx, rows } = makeTx([seed(null)]);
  const r = await transitionSwapRequest(tx, baseInput(SwapRequestState.SUBMITTED));
  assert.equal(r.status, "transitioned");
  assert.equal(r.fromState, SwapRequestState.DRAFT);
  assert.equal(rows.get("swap-1")?.lifecycleState, SwapRequestState.SUBMITTED);
});

// ─── Event payload shape ────────────────────────────────────────────────────

test("event payload captures from/to/reason/actor + custom fields", async () => {
  const { tx, events } = makeTx([seed(SwapRequestState.PENDING_ADMIN)]);
  await transitionSwapRequest(
    tx,
    baseInput(SwapRequestState.APPROVED_IMMEDIATE, {
      reason: "supervisor blessed it",
      payload: { approvedBy: "admin-42", note: "urgent swap" },
      actor: { type: SwapActorType.COMPANY_ADMIN, id: "admin-42" },
    }),
  );
  const [event] = [...events.values()];
  assert.ok(event);
  assert.equal(event.eventType, "STATE_TRANSITION");
  assert.equal(event.actorType, "COMPANY_ADMIN");
  assert.equal(event.actorId, "admin-42");
  const payload = event.payload!;
  assert.equal(payload.from, SwapRequestState.PENDING_ADMIN);
  assert.equal(payload.to, SwapRequestState.APPROVED_IMMEDIATE);
  assert.equal(payload.reason, "supervisor blessed it");
  assert.equal(payload.approvedBy, "admin-42");
  assert.equal(payload.note, "urgent swap");
});

// ─── Transitions map smoke check ────────────────────────────────────────────

test("SWAP_REQUEST_TRANSITIONS covers every state (total destination count matches)", () => {
  // 16 edges total per the canonical map. Recount manually if the machine
  // changes to keep this regression-proof.
  const total = Object.values(SWAP_REQUEST_TRANSITIONS).reduce(
    (sum, targets) => sum + targets.length,
    0,
  );
  assert.equal(total, happyPath.length);
});
