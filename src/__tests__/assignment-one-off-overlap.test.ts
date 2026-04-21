/**
 * Shape + overlap tests for Assignment.oneOffDates + AssignmentSource.ONE_OFF.
 *
 * Run: npm run build && node --test dist/__tests__/assignment-one-off-overlap.test.js
 *
 * Red before migration + schema + overlap-guard changes land.
 * Green once all three are in place.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Schema shape tests ────────────────────────────────────────────────────────

const SCHEMA_PATH = join(__dirname, "..", "..", "prisma", "schema.prisma");
const schema = readFileSync(SCHEMA_PATH, "utf8");

function extractBlock(kind: "model" | "enum", name: string): string | null {
  const re = new RegExp(`${kind}\\s+${name}\\s+\\{([\\s\\S]*?)\\n\\}`, "m");
  const m = schema.match(re);
  return m ? m[1] : null;
}

describe("AssignmentSource enum", () => {
  test("has ONE_OFF value", () => {
    const body = extractBlock("enum", "AssignmentSource");
    assert.ok(body, "enum AssignmentSource not found in schema.prisma");
    assert.match(body!, /\bONE_OFF\b/, "missing ONE_OFF in AssignmentSource enum");
  });
});

describe("Assignment model", () => {
  test("has oneOffDates DateTime[] field", () => {
    const body = extractBlock("model", "Assignment");
    assert.ok(body, "model Assignment not found in schema.prisma");
    assert.match(
      body!,
      /\boneOffDates\s+DateTime\[\]/,
      "Assignment missing oneOffDates DateTime[] field",
    );
  });

  test("oneOffDates has a default value", () => {
    const body = extractBlock("model", "Assignment");
    assert.ok(body);
    // The line should contain both the field and @default([])
    assert.match(
      body!,
      /\boneOffDates\s+DateTime\[\]\s+@default\(\[\]\)/,
      "Assignment.oneOffDates missing @default([])",
    );
  });
});

// ── Overlap guard logic tests (pure, no DB) ───────────────────────────────────

import {
  hasTimeOverlap,
  hasDayOverlap,
} from "../state-machines/assignment-overlap";

// Helper: build a mock tx that returns the given existing assignments
function mockTx(existing: Array<{
  id: string;
  siteId: string;
  days: number[];
  timeStart: string;
  timeEnd: string;
  oneOffDates?: Date[];
}>) {
  return {
    assignment: {
      findMany: async () => existing,
    },
  };
}

// ── hasDayOverlap tests ───────────────────────────────────────────────────────

describe("hasDayOverlap", () => {
  test("returns false when either side has empty days", () => {
    assert.equal(hasDayOverlap({ days: [] }, { days: [1, 2, 3] }), false);
    assert.equal(hasDayOverlap({ days: [1, 2, 3] }, { days: [] }), false);
    assert.equal(hasDayOverlap({ days: [] }, { days: [] }), false);
  });

  test("returns true when they share at least one day", () => {
    assert.equal(hasDayOverlap({ days: [1, 2] }, { days: [2, 3] }), true);
  });

  test("returns false when no shared days", () => {
    assert.equal(hasDayOverlap({ days: [1, 3] }, { days: [2, 4] }), false);
  });
});

// ── hasTimeOverlap tests ──────────────────────────────────────────────────────

describe("hasTimeOverlap", () => {
  test("back-to-back slots do NOT overlap", () => {
    assert.equal(hasTimeOverlap({ timeStart: "09:00", timeEnd: "12:00" }, { timeStart: "12:00", timeEnd: "15:00" }), false);
  });

  test("overlapping slots return true", () => {
    assert.equal(hasTimeOverlap({ timeStart: "09:00", timeEnd: "13:00" }, { timeStart: "12:00", timeEnd: "15:00" }), true);
  });
});

// ── assertNoAssignmentOverlap with oneOffDates ────────────────────────────────

import { assertNoAssignmentOverlap, AssignmentOverlapError } from "../state-machines/assignment-overlap";

/**
 * A Monday in 2026-05: 2026-05-04.
 * IST midnight = 2026-05-03T18:30:00Z stored in UTC.
 * For overlap purposes we compare the Date objects directly by ISO string.
 */
const MONDAY_2026_05_04 = new Date("2026-05-04T00:00:00.000Z");
const TUESDAY_2026_05_05 = new Date("2026-05-05T00:00:00.000Z");

describe("assertNoAssignmentOverlap with oneOffDates", () => {
  test("rejects a ONE_OFF that targets a date covered by recurring (same weekday+time)", async () => {
    const tx = mockTx([
      {
        id: "asn-recurring",
        siteId: "site-A",
        days: [1], // Monday
        timeStart: "09:00",
        timeEnd: "12:00",
        oneOffDates: [],
      },
    ]);

    await assert.rejects(
      () =>
        assertNoAssignmentOverlap(tx as never, {
          workerId: "w1",
          days: [],
          oneOffDates: [MONDAY_2026_05_04], // Monday 2026-05-04
          timeStart: "10:00",
          timeEnd: "11:00",
        }),
      AssignmentOverlapError,
      "expected AssignmentOverlapError when one-off overlaps recurring on same weekday+time",
    );
  });

  test("accepts a ONE_OFF on a date NOT covered by recurring (different weekday)", async () => {
    const tx = mockTx([
      {
        id: "asn-recurring",
        siteId: "site-A",
        days: [2], // Tuesday
        timeStart: "09:00",
        timeEnd: "12:00",
        oneOffDates: [],
      },
    ]);

    // Monday 2026-05-04: recurring only covers Tuesday, so no conflict
    await assert.doesNotReject(
      () =>
        assertNoAssignmentOverlap(tx as never, {
          workerId: "w1",
          days: [],
          oneOffDates: [MONDAY_2026_05_04],
          timeStart: "10:00",
          timeEnd: "11:00",
        }),
    );
  });

  test("rejects two one-off assignments when their dates AND times overlap", async () => {
    const tx = mockTx([
      {
        id: "asn-one-off-existing",
        siteId: "site-B",
        days: [],
        timeStart: "08:00",
        timeEnd: "11:00",
        oneOffDates: [MONDAY_2026_05_04],
      },
    ]);

    await assert.rejects(
      () =>
        assertNoAssignmentOverlap(tx as never, {
          workerId: "w1",
          days: [],
          oneOffDates: [MONDAY_2026_05_04], // same date
          timeStart: "10:00",
          timeEnd: "13:00", // time overlaps
        }),
      AssignmentOverlapError,
    );
  });

  test("accepts two one-off assignments on the same date when times do NOT overlap", async () => {
    const tx = mockTx([
      {
        id: "asn-one-off-existing",
        siteId: "site-B",
        days: [],
        timeStart: "08:00",
        timeEnd: "11:00",
        oneOffDates: [MONDAY_2026_05_04],
      },
    ]);

    await assert.doesNotReject(
      () =>
        assertNoAssignmentOverlap(tx as never, {
          workerId: "w1",
          days: [],
          oneOffDates: [MONDAY_2026_05_04],
          timeStart: "11:00", // starts exactly when existing ends — no overlap
          timeEnd: "14:00",
        }),
    );
  });

  test("accepts a ONE_OFF on a different date from existing one-off (no time check needed)", async () => {
    const tx = mockTx([
      {
        id: "asn-one-off-existing",
        siteId: "site-B",
        days: [],
        timeStart: "08:00",
        timeEnd: "14:00",
        oneOffDates: [MONDAY_2026_05_04],
      },
    ]);

    await assert.doesNotReject(
      () =>
        assertNoAssignmentOverlap(tx as never, {
          workerId: "w1",
          days: [],
          oneOffDates: [TUESDAY_2026_05_05], // different date
          timeStart: "08:00",
          timeEnd: "14:00",
        }),
    );
  });

  test("rejects if NEW has recurring days[] that would cover a date in existing one-off's dates", async () => {
    const tx = mockTx([
      {
        id: "asn-one-off-existing",
        siteId: "site-B",
        days: [],
        timeStart: "09:00",
        timeEnd: "12:00",
        oneOffDates: [MONDAY_2026_05_04], // Monday
      },
    ]);

    // New recurring covers Monday (day=1)
    await assert.rejects(
      () =>
        assertNoAssignmentOverlap(tx as never, {
          workerId: "w1",
          days: [1], // Monday
          oneOffDates: [],
          timeStart: "10:00",
          timeEnd: "11:00",
        }),
      AssignmentOverlapError,
      "recurring new that covers the same weekday as existing one-off should be rejected",
    );
  });
});
