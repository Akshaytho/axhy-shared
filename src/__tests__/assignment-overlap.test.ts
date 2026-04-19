/**
 * Tests for Sprint 10 overlap-guard helpers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AssignmentConfigState } from "../state-machines/assignment-config";
import {
  parseTimeToMinutes,
  hasTimeOverlap,
  hasDayOverlap,
  assertNoAssignmentOverlap,
  AssignmentOverlapError,
  RESERVED_TIME_STATES,
} from "../state-machines/assignment-overlap";
import type { AssignmentOverlapQueryClient } from "../state-machines/assignment-overlap";

// ─── parseTimeToMinutes ─────────────────────────────────────────────────────

test("parseTimeToMinutes: 00:00 → 0", () => {
  assert.equal(parseTimeToMinutes("00:00"), 0);
});

test("parseTimeToMinutes: 09:30 → 570", () => {
  assert.equal(parseTimeToMinutes("09:30"), 570);
});

test("parseTimeToMinutes: 23:59 → 1439", () => {
  assert.equal(parseTimeToMinutes("23:59"), 1439);
});

test("parseTimeToMinutes: malformed returns NaN", () => {
  assert.ok(Number.isNaN(parseTimeToMinutes("9:30")));
  assert.ok(Number.isNaN(parseTimeToMinutes("24:00")));
  assert.ok(Number.isNaN(parseTimeToMinutes("12:60")));
  assert.ok(Number.isNaN(parseTimeToMinutes("abc")));
  assert.ok(Number.isNaN(parseTimeToMinutes("")));
});

// ─── hasTimeOverlap ─────────────────────────────────────────────────────────

test("hasTimeOverlap: identical windows overlap", () => {
  assert.equal(
    hasTimeOverlap({ timeStart: "09:00", timeEnd: "17:00" }, { timeStart: "09:00", timeEnd: "17:00" }),
    true,
  );
});

test("hasTimeOverlap: fully contained overlap", () => {
  assert.equal(
    hasTimeOverlap({ timeStart: "09:00", timeEnd: "17:00" }, { timeStart: "10:00", timeEnd: "12:00" }),
    true,
  );
});

test("hasTimeOverlap: partial overlap at start", () => {
  assert.equal(
    hasTimeOverlap({ timeStart: "09:00", timeEnd: "12:00" }, { timeStart: "11:00", timeEnd: "14:00" }),
    true,
  );
});

test("hasTimeOverlap: back-to-back does NOT overlap", () => {
  assert.equal(
    hasTimeOverlap({ timeStart: "09:00", timeEnd: "12:00" }, { timeStart: "12:00", timeEnd: "14:00" }),
    false,
  );
});

test("hasTimeOverlap: fully separate", () => {
  assert.equal(
    hasTimeOverlap({ timeStart: "06:00", timeEnd: "08:00" }, { timeStart: "10:00", timeEnd: "12:00" }),
    false,
  );
});

test("hasTimeOverlap: malformed input returns false (fail-safe)", () => {
  assert.equal(
    hasTimeOverlap({ timeStart: "garbage", timeEnd: "17:00" }, { timeStart: "09:00", timeEnd: "17:00" }),
    false,
  );
});

test("hasTimeOverlap: zero-width window is never overlapping", () => {
  assert.equal(
    hasTimeOverlap({ timeStart: "09:00", timeEnd: "09:00" }, { timeStart: "09:00", timeEnd: "10:00" }),
    false,
  );
});

// ─── hasDayOverlap ──────────────────────────────────────────────────────────

test("hasDayOverlap: shared day", () => {
  assert.equal(hasDayOverlap({ days: [1, 2, 3] }, { days: [3, 4, 5] }), true);
});

test("hasDayOverlap: no shared day", () => {
  assert.equal(hasDayOverlap({ days: [1, 2] }, { days: [3, 4, 5] }), false);
});

test("hasDayOverlap: empty day arrays never overlap", () => {
  assert.equal(hasDayOverlap({ days: [] }, { days: [1] }), false);
  assert.equal(hasDayOverlap({ days: [1] }, { days: [] }), false);
});

// ─── RESERVED_TIME_STATES invariant ─────────────────────────────────────────

test("RESERVED_TIME_STATES excludes terminal + admin-attention states", () => {
  const reserved = new Set<string>(RESERVED_TIME_STATES);
  assert.ok(reserved.has(AssignmentConfigState.ACTIVE));
  assert.ok(reserved.has(AssignmentConfigState.PAUSED));
  // Not reserved: INACTIVE (terminal), DISCARDED (terminal),
  // WORKER_DEPARTED (worker gone), REASSIGNMENT_NEEDED (no one attached)
  assert.ok(!reserved.has(AssignmentConfigState.INACTIVE));
  assert.ok(!reserved.has(AssignmentConfigState.DISCARDED));
  assert.ok(!reserved.has(AssignmentConfigState.WORKER_DEPARTED));
  assert.ok(!reserved.has(AssignmentConfigState.REASSIGNMENT_NEEDED));
});

// ─── assertNoAssignmentOverlap (DB-backed) ──────────────────────────────────

type Row = {
  id: string;
  workerId: string;
  siteId: string;
  days: number[];
  timeStart: string;
  timeEnd: string;
  lifecycleState: string | null;
  isActive: boolean;
};

function makeQueryClient(rows: Row[]): AssignmentOverlapQueryClient {
  return {
    assignment: {
      async findMany({ where }) {
        // Minimal matcher emulating Prisma's shape:
        //   workerId + OR:[{lifecycleState:{in}}, {lifecycleState:null, isActive:true}]
        // Also respects id.not exclusion when present.
        const workerId = where.workerId as string;
        const idNot = (where.id as { not?: string } | undefined)?.not;
        const orClauses = where.OR as Array<Record<string, unknown>>;
        return rows
          .filter((r) => r.workerId === workerId && r.id !== idNot)
          .filter((r) => {
            return orClauses.some((clause) => {
              const ls = clause.lifecycleState as
                | { in?: string[] }
                | null
                | undefined;
              const active = clause.isActive as boolean | undefined;
              if (ls && typeof ls === "object" && "in" in ls) {
                return ls.in!.includes(r.lifecycleState ?? "");
              }
              if (ls === null) {
                return r.lifecycleState === null && r.isActive === active;
              }
              return false;
            });
          })
          .map((r) => ({
            id: r.id,
            siteId: r.siteId,
            days: r.days,
            timeStart: r.timeStart,
            timeEnd: r.timeEnd,
          }));
      },
    },
  };
}

test("assertNoAssignmentOverlap: no conflict passes silently", async () => {
  const tx = makeQueryClient([]);
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [1, 2, 3],
    timeStart: "09:00",
    timeEnd: "12:00",
  });
});

test("assertNoAssignmentOverlap: same time, same day on ACTIVE throws", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1, 2, 3],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.ACTIVE,
      isActive: true,
    },
  ]);
  await assert.rejects(
    () =>
      assertNoAssignmentOverlap(tx, {
        workerId: "w1",
        days: [2, 4],
        timeStart: "10:00",
        timeEnd: "11:00",
      }),
    (err) => err instanceof AssignmentOverlapError,
  );
});

test("assertNoAssignmentOverlap: same time DIFFERENT day passes", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1, 2, 3],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.ACTIVE,
      isActive: true,
    },
  ]);
  // Day 4 isn't in [1,2,3]
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [4, 5],
    timeStart: "10:00",
    timeEnd: "11:00",
  });
});

test("assertNoAssignmentOverlap: back-to-back same day passes", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.ACTIVE,
      isActive: true,
    },
  ]);
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [1],
    timeStart: "12:00",
    timeEnd: "15:00",
  });
});

test("assertNoAssignmentOverlap: INACTIVE assignment doesn't reserve time", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.INACTIVE,
      isActive: false,
    },
  ]);
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [1],
    timeStart: "10:00",
    timeEnd: "11:00",
  });
});

test("assertNoAssignmentOverlap: WORKER_DEPARTED doesn't reserve time", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.WORKER_DEPARTED,
      isActive: true,
    },
  ]);
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [1],
    timeStart: "10:00",
    timeEnd: "11:00",
  });
});

test("assertNoAssignmentOverlap: legacy null+isActive=true reserves time", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: null,
      isActive: true,
    },
  ]);
  await assert.rejects(
    () =>
      assertNoAssignmentOverlap(tx, {
        workerId: "w1",
        days: [1],
        timeStart: "10:00",
        timeEnd: "11:00",
      }),
    (err) => err instanceof AssignmentOverlapError,
  );
});

test("assertNoAssignmentOverlap: legacy null+isActive=false does NOT reserve time", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: null,
      isActive: false,
    },
  ]);
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [1],
    timeStart: "10:00",
    timeEnd: "11:00",
  });
});

test("assertNoAssignmentOverlap: excludeAssignmentId skips self when updating", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w1",
      siteId: "s1",
      days: [1, 2],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.ACTIVE,
      isActive: true,
    },
  ]);
  // Editing a1 itself — should not see itself as an overlap conflict
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [1, 2],
    timeStart: "10:00",
    timeEnd: "11:00",
    excludeAssignmentId: "a1",
  });
});

test("assertNoAssignmentOverlap: different worker doesn't conflict", async () => {
  const tx = makeQueryClient([
    {
      id: "a1",
      workerId: "w-other",
      siteId: "s1",
      days: [1],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.ACTIVE,
      isActive: true,
    },
  ]);
  await assertNoAssignmentOverlap(tx, {
    workerId: "w1",
    days: [1],
    timeStart: "10:00",
    timeEnd: "11:00",
  });
});

test("AssignmentOverlapError carries workerId + conflicting ids for UI surfacing", async () => {
  const tx = makeQueryClient([
    {
      id: "conflict-asn",
      workerId: "w1",
      siteId: "conflict-site",
      days: [1],
      timeStart: "09:00",
      timeEnd: "12:00",
      lifecycleState: AssignmentConfigState.ACTIVE,
      isActive: true,
    },
  ]);
  try {
    await assertNoAssignmentOverlap(tx, {
      workerId: "w1",
      days: [1],
      timeStart: "10:00",
      timeEnd: "11:00",
    });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AssignmentOverlapError);
    assert.equal(err.workerId, "w1");
    assert.equal(err.conflictingAssignmentId, "conflict-asn");
    assert.equal(err.conflictingSiteId, "conflict-site");
    assert.equal(err.code, "ASSIGNMENT_OVERLAP");
  }
});
