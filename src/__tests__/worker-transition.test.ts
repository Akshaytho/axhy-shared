/**
 * Tests for transitionWorker() — worker lifecycle state machine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerState, WORKER_TRANSITIONS } from "../state-machines/worker";
import {
  transitionWorker,
  WorkerActorType,
} from "../state-machines/worker-transition";
import type {
  WorkerTxClient,
  TransitionWorkerInput,
} from "../state-machines/worker-transition";
import {
  WorkerInvalidTransitionError,
  WorkerNotFoundError,
  MissingWorkerDecisionMetadataError,
} from "../state-machines/lifecycle-errors";
import { MissingIdempotencyKeyError } from "../state-machines/visit-errors";

interface MockUserRow {
  id: string;
  lifecycleState: string | null;
}

interface MockWorkerEventRow {
  id: string;
  idempotencyKey: string | null;
  userId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  actorType: string;
  actorId: string | null;
  createdAt: Date;
}

function makeTx(initialRows: MockUserRow[] = []) {
  const rows = new Map<string, MockUserRow>(initialRows.map((r) => [r.id, r]));
  const events = new Map<string, MockWorkerEventRow>();
  const eventsByIdempotency = new Map<string, MockWorkerEventRow>();
  let counter = 0;

  const tx: WorkerTxClient = {
    user: {
      async findUnique({ where }) {
        return rows.get(where.id) ?? null;
      },
      async update({ where, data }) {
        const r = rows.get(where.id);
        if (!r) throw new Error(`No user ${where.id}`);
        const updated = { ...r, ...(data as Partial<MockUserRow>) };
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
        const updated = { ...r, ...(data as Partial<MockUserRow>) };
        rows.set(id, updated);
        return { count: 1 };
      },
    },
    workerLifecycleEvent: {
      async findUnique({ where }) {
        return eventsByIdempotency.get(where.idempotencyKey) ?? null;
      },
      async create({ data }) {
        const id = `worker-event-${++counter}`;
        const row: MockWorkerEventRow = {
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

function seed(state: WorkerState | null): MockUserRow {
  return { id: "user-1", lifecycleState: state };
}

function baseInput(
  to: WorkerState,
  overrides: Partial<TransitionWorkerInput> = {},
): TransitionWorkerInput {
  return {
    userId: "user-1",
    to,
    actor: { type: WorkerActorType.SYSTEM, id: null },
    reason: "test",
    idempotencyKey: `idem-${to}-${Math.random()}`,
    ...overrides,
  };
}

// Build the full happy-path list from the canonical transition map so any
// machine change automatically updates coverage.
const happyPath: Array<{
  from: WorkerState;
  to: WorkerState;
  payload?: Record<string, unknown>;
}> = [];

for (const [fromStr, targets] of Object.entries(WORKER_TRANSITIONS)) {
  const from = fromStr as WorkerState;
  for (const to of targets) {
    const payload: Record<string, unknown> | undefined = (() => {
      if (to === WorkerState.TERMINATED || to === WorkerState.TERMINATED_PROBATION) {
        return { terminatedBy: "admin-1", reason: "poor performance" };
      }
      if (to === WorkerState.SUSPENDED_INVESTIGATION) {
        return { suspendedBy: "admin-1", incidentId: "fraud-1" };
      }
      if (to === WorkerState.COACHING) {
        return { coachingPlanId: "plan-1" };
      }
      if (to === WorkerState.REJECTED_APPLICANT) {
        return { rejectionReason: "failed background check" };
      }
      return undefined;
    })();
    happyPath.push({ from, to, payload });
  }
}

for (const c of happyPath) {
  test(`worker happy: ${c.from} → ${c.to}`, async () => {
    const { tx, rows, events } = makeTx([seed(c.from)]);
    const res = await transitionWorker(tx, baseInput(c.to, { payload: c.payload }));
    assert.equal(res.status, "transitioned");
    assert.equal(res.fromState, c.from);
    assert.equal(res.toState, c.to);
    assert.equal(rows.get("user-1")?.lifecycleState, c.to);
    assert.equal(events.size, 1);
  });
}

// ─── Invalid transitions ────────────────────────────────────────────────────

test("worker invalid: APPLICANT → ACTIVE (skip onboarding) rejects", async () => {
  const { tx } = makeTx([seed(WorkerState.APPLICANT)]);
  await assert.rejects(
    () => transitionWorker(tx, baseInput(WorkerState.ACTIVE)),
    (err) => err instanceof WorkerInvalidTransitionError,
  );
});

test("worker invalid: DEPARTED → ACTIVE (must go through ONBOARDING) rejects", async () => {
  const { tx } = makeTx([seed(WorkerState.DEPARTED)]);
  await assert.rejects(
    () => transitionWorker(tx, baseInput(WorkerState.ACTIVE)),
    (err) => err instanceof WorkerInvalidTransitionError,
  );
});

test("worker invalid: REJECTED_APPLICANT → anything rejects", async () => {
  const { tx } = makeTx([seed(WorkerState.REJECTED_APPLICANT)]);
  await assert.rejects(
    () => transitionWorker(tx, baseInput(WorkerState.ONBOARDING)),
    (err) => err instanceof WorkerInvalidTransitionError,
  );
});

// ─── Mandatory metadata ─────────────────────────────────────────────────────

test("TERMINATED without terminatedBy throws", async () => {
  const { tx } = makeTx([seed(WorkerState.COACHING)]);
  await assert.rejects(
    () => transitionWorker(tx, baseInput(WorkerState.TERMINATED)),
    (err) => err instanceof MissingWorkerDecisionMetadataError,
  );
});

test("TERMINATED without reason throws", async () => {
  const { tx } = makeTx([seed(WorkerState.COACHING)]);
  await assert.rejects(
    () =>
      transitionWorker(
        tx,
        baseInput(WorkerState.TERMINATED, { payload: { terminatedBy: "admin-1" } }),
      ),
    (err) => err instanceof MissingWorkerDecisionMetadataError,
  );
});

test("SUSPENDED_INVESTIGATION without incidentId throws", async () => {
  const { tx } = makeTx([seed(WorkerState.ACTIVE)]);
  await assert.rejects(
    () =>
      transitionWorker(
        tx,
        baseInput(WorkerState.SUSPENDED_INVESTIGATION, {
          payload: { suspendedBy: "admin-1" },
        }),
      ),
    (err) => err instanceof MissingWorkerDecisionMetadataError,
  );
});

test("COACHING without coachingPlanId throws", async () => {
  const { tx } = makeTx([seed(WorkerState.ACTIVE)]);
  await assert.rejects(
    () => transitionWorker(tx, baseInput(WorkerState.COACHING)),
    (err) => err instanceof MissingWorkerDecisionMetadataError,
  );
});

test("REJECTED_APPLICANT without rejectionReason throws", async () => {
  const { tx } = makeTx([seed(WorkerState.APPLICANT)]);
  await assert.rejects(
    () => transitionWorker(tx, baseInput(WorkerState.REJECTED_APPLICANT)),
    (err) => err instanceof MissingWorkerDecisionMetadataError,
  );
});

// ─── Idempotency ────────────────────────────────────────────────────────────

test("worker idempotency: duplicate key = no double write", async () => {
  const { tx, events } = makeTx([seed(WorkerState.APPLICANT)]);
  const input = baseInput(WorkerState.SCREENING, { idempotencyKey: "stable" });
  const r1 = await transitionWorker(tx, input);
  const r2 = await transitionWorker(tx, input);
  assert.equal(r1.status, "transitioned");
  assert.equal(r2.status, "duplicate");
  assert.equal(events.size, 1);
});

test("worker empty idempotencyKey rejects", async () => {
  const { tx } = makeTx([seed(WorkerState.APPLICANT)]);
  await assert.rejects(
    () =>
      transitionWorker(tx, baseInput(WorkerState.SCREENING, { idempotencyKey: "" })),
    (err) => err instanceof MissingIdempotencyKeyError,
  );
});

// ─── Not-found + null default ───────────────────────────────────────────────

test("worker not-found throws WorkerNotFoundError", async () => {
  const { tx } = makeTx([]);
  await assert.rejects(
    () => transitionWorker(tx, baseInput(WorkerState.SCREENING)),
    (err) => err instanceof WorkerNotFoundError,
  );
});

test("null lifecycleState defaults to APPLICANT", async () => {
  const { tx, rows } = makeTx([seed(null)]);
  const r = await transitionWorker(tx, baseInput(WorkerState.SCREENING));
  assert.equal(r.status, "transitioned");
  assert.equal(r.fromState, WorkerState.APPLICANT);
  assert.equal(rows.get("user-1")?.lifecycleState, WorkerState.SCREENING);
});

// ─── Re-hire flow: DEPARTED → ONBOARDING ────────────────────────────────────

test("re-hire: DEPARTED → ONBOARDING is the only allowed edge", async () => {
  const { tx, rows } = makeTx([seed(WorkerState.DEPARTED)]);
  const r = await transitionWorker(tx, baseInput(WorkerState.ONBOARDING));
  assert.equal(r.status, "transitioned");
  assert.equal(rows.get("user-1")?.lifecycleState, WorkerState.ONBOARDING);
});

// ─── Event payload shape ────────────────────────────────────────────────────

test("worker event payload captures decision metadata", async () => {
  const { tx, events } = makeTx([seed(WorkerState.ACTIVE)]);
  await transitionWorker(
    tx,
    baseInput(WorkerState.SUSPENDED_INVESTIGATION, {
      reason: "photo tampering report",
      payload: { suspendedBy: "admin-7", incidentId: "fraud-9" },
      actor: { type: WorkerActorType.SUPER_ADMIN, id: "admin-7" },
    }),
  );
  const [event] = [...events.values()];
  assert.ok(event);
  assert.equal(event.actorType, "SUPER_ADMIN");
  const payload = event.payload!;
  assert.equal(payload.from, WorkerState.ACTIVE);
  assert.equal(payload.to, WorkerState.SUSPENDED_INVESTIGATION);
  assert.equal(payload.suspendedBy, "admin-7");
  assert.equal(payload.incidentId, "fraud-9");
});
