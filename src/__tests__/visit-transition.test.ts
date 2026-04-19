/**
 * Comprehensive tests for transitionVisit() — the single sanctioned path to
 * change a SiteVisit's lifecycleStatus.
 *
 * Covers per LOCKED v1.1:
 *   - All 26 valid state transitions succeed (T-02..T-26 excluding T-01 null→SCHEDULED)
 *   - All 7 categories of invalid transitions are rejected
 *   - Idempotency: same key → no duplicate write
 *   - Mandatory rejection metadata enforcement
 *   - Restoration-mode flag handling for POST_COMPLAINT_REVIEW flows
 *   - No-op handling for same-state "transitions"
 *   - Event payload shape
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { VisitState, RejectionReason } from "../state-machines/visit";
import { transitionVisit, buildEventType } from "../state-machines/visit-transition";
import type {
  VisitTxClient,
  TransitionVisitInput,
} from "../state-machines/visit-transition";
import {
  InvalidTransitionError,
  VisitNotFoundError,
  MissingRejectionMetadataError,
  MissingFraudCaseError,
  MissingComplaintIdError,
  MissingIdempotencyKeyError,
} from "../state-machines/visit-errors";

// ─────────────────────────────────────────────────────────────────────────────
// Mock Prisma-like tx client (in-memory)
// ─────────────────────────────────────────────────────────────────────────────

interface MockVisitRow {
  id: string;
  lifecycleStatus: string;
  assignmentId: string;
  postComplaintReviewed: boolean;
  postComplaintOutcome: string | null;
  updatedAt: Date;
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

function makeTx(initialVisits: MockVisitRow[] = []): {
  tx: VisitTxClient;
  visits: Map<string, MockVisitRow>;
  events: Map<string, MockEventRow>;
  eventsByIdempotency: Map<string, MockEventRow>;
} {
  const visits = new Map<string, MockVisitRow>(initialVisits.map((v) => [v.id, v]));
  const events = new Map<string, MockEventRow>();
  const eventsByIdempotency = new Map<string, MockEventRow>();
  let eventCounter = 0;

  const tx: VisitTxClient = {
    siteVisit: {
      async findUnique({ where }) {
        return visits.get(where.id) ?? null;
      },
      async update({ where, data }) {
        const v = visits.get(where.id);
        if (!v) throw new Error(`No visit ${where.id}`);
        const updated: MockVisitRow = {
          ...v,
          ...(data as Partial<MockVisitRow>),
        };
        visits.set(where.id, updated);
        return updated;
      },
    },
    assignmentEvent: {
      async findUnique({ where }) {
        return eventsByIdempotency.get(where.idempotencyKey) ?? null;
      },
      async create({ data }) {
        const id = `event-${++eventCounter}`;
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
        if (row.idempotencyKey) {
          eventsByIdempotency.set(row.idempotencyKey, row);
        }
        return row;
      },
    },
  };

  return { tx, visits, events, eventsByIdempotency };
}

function seedVisit(state: VisitState): MockVisitRow {
  return {
    id: "visit-1",
    lifecycleStatus: state,
    assignmentId: "assignment-1",
    postComplaintReviewed: false,
    postComplaintOutcome: null,
    updatedAt: new Date("2026-04-19T00:00:00Z"),
  };
}

function baseInput(
  to: VisitState,
  overrides: Partial<TransitionVisitInput> = {},
): TransitionVisitInput {
  return {
    visitId: "visit-1",
    to,
    actor: { type: "SYSTEM", id: null },
    reason: "test",
    idempotencyKey: `idem-${to}-${Math.random()}`,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy-path coverage: all 25 state-to-state valid transitions
// ─────────────────────────────────────────────────────────────────────────────

const happyPathCases: Array<{
  id: string;
  from: VisitState;
  to: VisitState;
  extraPayload?: Record<string, unknown>;
}> = [
  { id: "T-02", from: VisitState.SCHEDULED, to: VisitState.NOTIFIED },
  { id: "T-03", from: VisitState.SCHEDULED, to: VisitState.CANCELLED },
  { id: "T-04", from: VisitState.NOTIFIED, to: VisitState.CHECKED_IN },
  { id: "T-05", from: VisitState.NOTIFIED, to: VisitState.NO_SHOW_SUSPECTED },
  { id: "T-06", from: VisitState.NOTIFIED, to: VisitState.CANCELLED },
  { id: "T-07", from: VisitState.NO_SHOW_SUSPECTED, to: VisitState.CHECKED_IN },
  {
    id: "T-08",
    from: VisitState.NO_SHOW_SUSPECTED,
    to: VisitState.REPLACEMENT_REQUESTED,
  },
  {
    id: "T-09",
    from: VisitState.REPLACEMENT_REQUESTED,
    to: VisitState.HANDOFF_REPLACED,
  },
  { id: "T-10", from: VisitState.REPLACEMENT_REQUESTED, to: VisitState.UNCOVERED },
  { id: "T-11", from: VisitState.CHECKED_IN, to: VisitState.IN_PROGRESS },
  { id: "T-12", from: VisitState.IN_PROGRESS, to: VisitState.SUBMITTED },
  { id: "T-13", from: VisitState.SUBMITTED, to: VisitState.VERIFIED },
  { id: "T-14", from: VisitState.SUBMITTED, to: VisitState.PARTIAL },
  { id: "T-15", from: VisitState.SUBMITTED, to: VisitState.FLAGGED },
  { id: "T-16", from: VisitState.VERIFIED, to: VisitState.COMPLETED_VERIFIED },
  {
    id: "T-17",
    from: VisitState.PARTIAL,
    to: VisitState.COMPLETED_PARTIAL_APPROVED,
  },
  {
    id: "T-18",
    from: VisitState.FLAGGED,
    to: VisitState.COMPLETED_FLAGGED_WAIVED,
  },
  {
    id: "T-19",
    from: VisitState.FLAGGED,
    to: VisitState.REJECTED,
    extraPayload: {
      rejectionReason: RejectionReason.QUALITY_UNACCEPTABLE,
      rejectionDetail: "Photo blurry beyond recognition",
    },
  },
  {
    id: "T-20",
    from: VisitState.COMPLETED_VERIFIED,
    to: VisitState.POST_COMPLAINT_REVIEW,
  },
  {
    id: "T-21",
    from: VisitState.COMPLETED_PARTIAL_APPROVED,
    to: VisitState.POST_COMPLAINT_REVIEW,
  },
  {
    id: "T-22",
    from: VisitState.COMPLETED_FLAGGED_WAIVED,
    to: VisitState.POST_COMPLAINT_REVIEW,
  },
  {
    id: "T-23",
    from: VisitState.POST_COMPLAINT_REVIEW,
    to: VisitState.COMPLETED_VERIFIED,
  },
  {
    id: "T-24",
    from: VisitState.POST_COMPLAINT_REVIEW,
    to: VisitState.COMPLETED_PARTIAL_APPROVED,
  },
  {
    id: "T-25",
    from: VisitState.POST_COMPLAINT_REVIEW,
    to: VisitState.COMPLETED_FLAGGED_WAIVED,
  },
  {
    id: "T-26",
    from: VisitState.POST_COMPLAINT_REVIEW,
    to: VisitState.REJECTED,
    extraPayload: {
      rejectionReason: RejectionReason.CLIENT_COMPLAINT_UPHELD,
      rejectionDetail: "Client provided photo evidence of missed area",
      complaintId: "complaint-123",
    },
  },
];

for (const c of happyPathCases) {
  test(`happy path ${c.id}: ${c.from} → ${c.to}`, async () => {
    const { tx, visits } = makeTx([seedVisit(c.from)]);
    const result = await transitionVisit(
      tx,
      baseInput(c.to, { payload: c.extraPayload }),
    );
    assert.equal(result.status, "transitioned");
    assert.equal(result.fromState, c.from);
    assert.equal(result.toState, c.to);
    assert.equal(visits.get("visit-1")!.lifecycleStatus, c.to);
  });
}

test(`happy path count matches locked spec: 25 state-to-state valid transitions`, () => {
  assert.equal(happyPathCases.length, 25);
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid transitions: 7 rule categories from locked spec section 3
// ─────────────────────────────────────────────────────────────────────────────

test("rule A: transitions FROM pure terminals all throw", async () => {
  const pureTerminals = [
    VisitState.HANDOFF_REPLACED,
    VisitState.UNCOVERED,
    VisitState.REJECTED,
    VisitState.CANCELLED,
  ];
  for (const terminal of pureTerminals) {
    for (const target of Object.values(VisitState)) {
      if (target === terminal) continue;
      const { tx } = makeTx([seedVisit(terminal)]);
      await assert.rejects(
        () => transitionVisit(tx, baseInput(target)),
        InvalidTransitionError,
        `pure terminal ${terminal} must not transition to ${target}`,
      );
    }
  }
});

test("rule B: cannot rewind workflow (CHECKED_IN → NOTIFIED)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.CHECKED_IN)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.NOTIFIED)),
    InvalidTransitionError,
  );
});

test("rule B: cannot rewind workflow (IN_PROGRESS → CHECKED_IN)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.IN_PROGRESS)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.CHECKED_IN)),
    InvalidTransitionError,
  );
});

test("rule B: cannot rewind workflow (SUBMITTED → IN_PROGRESS)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.SUBMITTED)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.IN_PROGRESS)),
    InvalidTransitionError,
  );
});

test("rule C: cannot skip NOTIFIED (SCHEDULED → CHECKED_IN)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.SCHEDULED)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.CHECKED_IN)),
    InvalidTransitionError,
  );
});

test("rule C: cannot skip CHECKED_IN (NOTIFIED → IN_PROGRESS)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.NOTIFIED)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.IN_PROGRESS)),
    InvalidTransitionError,
  );
});

test("rule D: cannot change outcome (VERIFIED → PARTIAL)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.VERIFIED)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.PARTIAL)),
    InvalidTransitionError,
  );
});

test("rule D: cannot change outcome (PARTIAL → FLAGGED)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.PARTIAL)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.FLAGGED)),
    InvalidTransitionError,
  );
});

test("rule E: REPLACEMENT_REQUESTED cannot go directly to CHECKED_IN", async () => {
  const { tx } = makeTx([seedVisit(VisitState.REPLACEMENT_REQUESTED)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.CHECKED_IN)),
    InvalidTransitionError,
  );
});

test("rule F: POST_COMPLAINT_REVIEW cannot exit to arbitrary state (SCHEDULED)", async () => {
  const { tx } = makeTx([seedVisit(VisitState.POST_COMPLAINT_REVIEW)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.SCHEDULED)),
    InvalidTransitionError,
  );
});

test("rule G: self-transition is a no-op, not an error", async () => {
  const { tx, events } = makeTx([seedVisit(VisitState.NOTIFIED)]);
  const result = await transitionVisit(tx, baseInput(VisitState.NOTIFIED));
  assert.equal(result.status, "no-op");
  assert.equal(events.size, 0, "no event written for self-transition");
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────

test("idempotency: same key returns existing event, no duplicate write", async () => {
  const { tx, events, visits } = makeTx([seedVisit(VisitState.SCHEDULED)]);
  const input = baseInput(VisitState.NOTIFIED, { idempotencyKey: "idem-abc" });
  const first = await transitionVisit(tx, input);
  const second = await transitionVisit(tx, input);
  assert.equal(first.status, "transitioned");
  assert.equal(second.status, "duplicate");
  assert.equal(second.eventId, first.eventId);
  assert.equal(events.size, 1, "exactly one event written");
  assert.equal(visits.get("visit-1")!.lifecycleStatus, VisitState.NOTIFIED);
});

test("idempotency: missing key throws", async () => {
  const { tx } = makeTx([seedVisit(VisitState.SCHEDULED)]);
  await assert.rejects(
    () =>
      transitionVisit(tx, { ...baseInput(VisitState.NOTIFIED), idempotencyKey: "" }),
    MissingIdempotencyKeyError,
  );
});

test("idempotency: whitespace-only key throws", async () => {
  const { tx } = makeTx([seedVisit(VisitState.SCHEDULED)]);
  await assert.rejects(
    () =>
      transitionVisit(tx, {
        ...baseInput(VisitState.NOTIFIED),
        idempotencyKey: "   ",
      }),
    MissingIdempotencyKeyError,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Mandatory rejection metadata
// ─────────────────────────────────────────────────────────────────────────────

test("REJECTED: missing rejectionReason throws MissingRejectionMetadataError", async () => {
  const { tx } = makeTx([seedVisit(VisitState.FLAGGED)]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.REJECTED, { payload: {} })),
    MissingRejectionMetadataError,
  );
});

test("REJECTED: invalid rejectionReason throws", async () => {
  const { tx } = makeTx([seedVisit(VisitState.FLAGGED)]);
  await assert.rejects(
    () =>
      transitionVisit(
        tx,
        baseInput(VisitState.REJECTED, {
          payload: { rejectionReason: "NOT_AN_ENUM_VALUE", rejectionDetail: "x" },
        }),
      ),
    MissingRejectionMetadataError,
  );
});

test("REJECTED: missing rejectionDetail throws", async () => {
  const { tx } = makeTx([seedVisit(VisitState.FLAGGED)]);
  await assert.rejects(
    () =>
      transitionVisit(
        tx,
        baseInput(VisitState.REJECTED, {
          payload: { rejectionReason: RejectionReason.QUALITY_UNACCEPTABLE },
        }),
      ),
    MissingRejectionMetadataError,
  );
});

test("REJECTED: empty rejectionDetail throws", async () => {
  const { tx } = makeTx([seedVisit(VisitState.FLAGGED)]);
  await assert.rejects(
    () =>
      transitionVisit(
        tx,
        baseInput(VisitState.REJECTED, {
          payload: {
            rejectionReason: RejectionReason.QUALITY_UNACCEPTABLE,
            rejectionDetail: "   ",
          },
        }),
      ),
    MissingRejectionMetadataError,
  );
});

test("REJECTED+FRAUD: missing fraudCaseId throws MissingFraudCaseError", async () => {
  const { tx } = makeTx([seedVisit(VisitState.FLAGGED)]);
  await assert.rejects(
    () =>
      transitionVisit(
        tx,
        baseInput(VisitState.REJECTED, {
          payload: {
            rejectionReason: RejectionReason.FRAUD,
            rejectionDetail: "pHash match",
          },
        }),
      ),
    MissingFraudCaseError,
  );
});

test("REJECTED+FRAUD with fraudCaseId succeeds", async () => {
  const { tx } = makeTx([seedVisit(VisitState.FLAGGED)]);
  const result = await transitionVisit(
    tx,
    baseInput(VisitState.REJECTED, {
      payload: {
        rejectionReason: RejectionReason.FRAUD,
        rejectionDetail: "pHash match",
        fraudCaseId: "fraud-99",
      },
    }),
  );
  assert.equal(result.status, "transitioned");
});

test("REJECTED+CLIENT_COMPLAINT_UPHELD: missing complaintId throws", async () => {
  const { tx } = makeTx([seedVisit(VisitState.POST_COMPLAINT_REVIEW)]);
  await assert.rejects(
    () =>
      transitionVisit(
        tx,
        baseInput(VisitState.REJECTED, {
          payload: {
            rejectionReason: RejectionReason.CLIENT_COMPLAINT_UPHELD,
            rejectionDetail: "evidence confirmed",
          },
        }),
      ),
    MissingComplaintIdError,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Restoration-mode + complaint-review flags
// ─────────────────────────────────────────────────────────────────────────────

test("T-20 entering POST_COMPLAINT_REVIEW sets postComplaintReviewed=true", async () => {
  const { tx, visits } = makeTx([seedVisit(VisitState.COMPLETED_VERIFIED)]);
  const result = await transitionVisit(
    tx,
    baseInput(VisitState.POST_COMPLAINT_REVIEW),
  );
  assert.equal(result.status, "transitioned");
  assert.equal(visits.get("visit-1")!.postComplaintReviewed, true);
  assert.equal(visits.get("visit-1")!.postComplaintOutcome, null);
});

test("T-23 restoration sets postComplaintOutcome=DISMISSED and isRestoration=true", async () => {
  const v = seedVisit(VisitState.POST_COMPLAINT_REVIEW);
  v.postComplaintReviewed = true;
  const { tx, visits, eventsByIdempotency } = makeTx([v]);
  const result = await transitionVisit(
    tx,
    baseInput(VisitState.COMPLETED_VERIFIED, { idempotencyKey: "restore-1" }),
  );
  assert.equal(result.isRestoration, true);
  assert.equal(visits.get("visit-1")!.postComplaintOutcome, "DISMISSED");
  assert.equal(visits.get("visit-1")!.postComplaintReviewed, true);
  const event = eventsByIdempotency.get("restore-1");
  assert.ok(event, "event written");
  assert.equal((event!.payload as Record<string, unknown>).restorationMode, true);
});

test("T-24 restoration to COMPLETED_PARTIAL_APPROVED marks DISMISSED", async () => {
  const v = seedVisit(VisitState.POST_COMPLAINT_REVIEW);
  v.postComplaintReviewed = true;
  const { tx, visits } = makeTx([v]);
  await transitionVisit(tx, baseInput(VisitState.COMPLETED_PARTIAL_APPROVED));
  assert.equal(visits.get("visit-1")!.postComplaintOutcome, "DISMISSED");
});

test("T-25 restoration to COMPLETED_FLAGGED_WAIVED marks DISMISSED", async () => {
  const v = seedVisit(VisitState.POST_COMPLAINT_REVIEW);
  v.postComplaintReviewed = true;
  const { tx, visits } = makeTx([v]);
  await transitionVisit(tx, baseInput(VisitState.COMPLETED_FLAGGED_WAIVED));
  assert.equal(visits.get("visit-1")!.postComplaintOutcome, "DISMISSED");
});

test("T-26 upheld → REJECTED marks postComplaintOutcome=UPHELD", async () => {
  const v = seedVisit(VisitState.POST_COMPLAINT_REVIEW);
  v.postComplaintReviewed = true;
  const { tx, visits } = makeTx([v]);
  await transitionVisit(
    tx,
    baseInput(VisitState.REJECTED, {
      payload: {
        rejectionReason: RejectionReason.CLIENT_COMPLAINT_UPHELD,
        rejectionDetail: "evidence confirmed the complaint",
        complaintId: "complaint-7",
      },
    }),
  );
  assert.equal(visits.get("visit-1")!.postComplaintOutcome, "UPHELD");
});

// ─────────────────────────────────────────────────────────────────────────────
// Event payload shape
// ─────────────────────────────────────────────────────────────────────────────

test("event payload carries from, to, reason, restorationMode, and extras", async () => {
  const { tx, eventsByIdempotency } = makeTx([seedVisit(VisitState.NOTIFIED)]);
  await transitionVisit(tx, {
    visitId: "visit-1",
    to: VisitState.CHECKED_IN,
    actor: { type: "WORKER", id: "user-abc" },
    reason: "GPS within geofence",
    idempotencyKey: "key-1",
    payload: { gpsAccuracy: 12.3, deviceId: "dev-1" },
  });
  const event = eventsByIdempotency.get("key-1")!;
  assert.ok(event);
  assert.equal(event.eventType, "STATE_TRANSITION_CHECKED_IN");
  assert.equal(event.actorType, "WORKER");
  assert.equal(event.actorId, "user-abc");
  const p = event.payload as Record<string, unknown>;
  assert.equal(p.from, VisitState.NOTIFIED);
  assert.equal(p.to, VisitState.CHECKED_IN);
  assert.equal(p.reason, "GPS within geofence");
  assert.equal(p.restorationMode, false);
  assert.equal(p.gpsAccuracy, 12.3);
  assert.equal(p.deviceId, "dev-1");
});

test("eventType prefix is STATE_TRANSITION_<to>", () => {
  assert.equal(buildEventType(VisitState.CHECKED_IN), "STATE_TRANSITION_CHECKED_IN");
  assert.equal(
    buildEventType(VisitState.COMPLETED_VERIFIED),
    "STATE_TRANSITION_COMPLETED_VERIFIED",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Visit not found
// ─────────────────────────────────────────────────────────────────────────────

test("VisitNotFoundError when visitId doesn't exist", async () => {
  const { tx } = makeTx([]);
  await assert.rejects(
    () => transitionVisit(tx, baseInput(VisitState.NOTIFIED)),
    VisitNotFoundError,
  );
});
