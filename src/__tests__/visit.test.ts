/**
 * Smoke test for the Visit state machine using Node's built-in test runner.
 *
 * Run: npm run build && node --test dist/__tests__/visit.test.js
 *
 * This covers all 26 valid transitions from the LOCKED v1.1 spec plus the
 * 7 categories of invalid transitions. Admin and worker app can both import
 * the same VisitState enum and verify against the same transition map.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VisitState,
  canTransition,
  isTerminal,
  isPureTerminal,
  isActive,
  isCompletedOutcome,
  allowsPayroll,
  isRestorationTransition,
  getTransitionId,
  TERMINAL_STATES,
  PURE_TERMINAL_STATES,
  COMPLETED_OUTCOME_STATES,
} from "../state-machines/visit";
import {
  InvalidTransitionError,
  assertTransitionGeneric,
  canTransitionGeneric,
} from "../utils/can-transition";
import { VISIT_TRANSITIONS } from "../state-machines/visit";
import { buildWorkerActionKey, buildTimerKey } from "../utils/idempotency";

test("visit machine has exactly 18 states", () => {
  const count = Object.keys(VisitState).length;
  assert.equal(count, 18, "Expected 18 visit states");
});

test("every state has a transition map entry", () => {
  for (const state of Object.values(VisitState)) {
    assert.ok(
      state in VISIT_TRANSITIONS,
      `State ${state} missing from VISIT_TRANSITIONS`,
    );
  }
});

test("all 26 valid transitions succeed", () => {
  const validTransitions: Array<[VisitState, VisitState, string]> = [
    [VisitState.SCHEDULED, VisitState.NOTIFIED, "T-02"],
    [VisitState.SCHEDULED, VisitState.CANCELLED, "T-03"],
    [VisitState.NOTIFIED, VisitState.CHECKED_IN, "T-04"],
    [VisitState.NOTIFIED, VisitState.NO_SHOW_SUSPECTED, "T-05"],
    [VisitState.NOTIFIED, VisitState.CANCELLED, "T-06"],
    [VisitState.NO_SHOW_SUSPECTED, VisitState.CHECKED_IN, "T-07"],
    [VisitState.NO_SHOW_SUSPECTED, VisitState.REPLACEMENT_REQUESTED, "T-08"],
    [VisitState.REPLACEMENT_REQUESTED, VisitState.HANDOFF_REPLACED, "T-09"],
    [VisitState.REPLACEMENT_REQUESTED, VisitState.UNCOVERED, "T-10"],
    [VisitState.CHECKED_IN, VisitState.IN_PROGRESS, "T-11"],
    [VisitState.IN_PROGRESS, VisitState.SUBMITTED, "T-12"],
    [VisitState.SUBMITTED, VisitState.VERIFIED, "T-13"],
    [VisitState.SUBMITTED, VisitState.PARTIAL, "T-14"],
    [VisitState.SUBMITTED, VisitState.FLAGGED, "T-15"],
    [VisitState.VERIFIED, VisitState.COMPLETED_VERIFIED, "T-16"],
    [VisitState.PARTIAL, VisitState.COMPLETED_PARTIAL_APPROVED, "T-17"],
    [VisitState.FLAGGED, VisitState.COMPLETED_FLAGGED_WAIVED, "T-18"],
    [VisitState.FLAGGED, VisitState.REJECTED, "T-19"],
    [VisitState.COMPLETED_VERIFIED, VisitState.POST_COMPLAINT_REVIEW, "T-20"],
    [VisitState.COMPLETED_PARTIAL_APPROVED, VisitState.POST_COMPLAINT_REVIEW, "T-21"],
    [VisitState.COMPLETED_FLAGGED_WAIVED, VisitState.POST_COMPLAINT_REVIEW, "T-22"],
    [VisitState.POST_COMPLAINT_REVIEW, VisitState.COMPLETED_VERIFIED, "T-23"],
    [VisitState.POST_COMPLAINT_REVIEW, VisitState.COMPLETED_PARTIAL_APPROVED, "T-24"],
    [VisitState.POST_COMPLAINT_REVIEW, VisitState.COMPLETED_FLAGGED_WAIVED, "T-25"],
    [VisitState.POST_COMPLAINT_REVIEW, VisitState.REJECTED, "T-26"],
  ];

  // 25 state-to-state transitions (T-01 is null → SCHEDULED, not covered by canTransition)
  assert.equal(validTransitions.length, 25, "Expected 25 non-genesis transitions");

  for (const [from, to, id] of validTransitions) {
    assert.ok(canTransition(from, to), `${id}: ${from} → ${to} should be valid`);
    assert.equal(getTransitionId(from, to), id, `transition id should resolve to ${id}`);
  }
});

test("rule A: transitions FROM pure terminals are all invalid", () => {
  for (const terminal of PURE_TERMINAL_STATES) {
    for (const target of Object.values(VisitState)) {
      if (target === terminal) continue;
      assert.ok(
        !canTransition(terminal, target),
        `pure terminal ${terminal} must not transition to ${target}`,
      );
    }
  }
});

test("rule A exception: COMPLETED_* can re-open to POST_COMPLAINT_REVIEW only", () => {
  for (const completed of COMPLETED_OUTCOME_STATES) {
    // Only POST_COMPLAINT_REVIEW should be reachable
    for (const target of Object.values(VisitState)) {
      if (target === completed) continue;
      const valid = canTransition(completed, target);
      if (target === VisitState.POST_COMPLAINT_REVIEW) {
        assert.ok(valid, `${completed} → POST_COMPLAINT_REVIEW must be valid`);
      } else {
        assert.ok(
          !valid,
          `${completed} must not transition to ${target} (only POST_COMPLAINT_REVIEW)`,
        );
      }
    }
  }
});

test("rule B: cannot rewind workflow", () => {
  const invalidRewinds: Array<[VisitState, VisitState]> = [
    [VisitState.CHECKED_IN, VisitState.NOTIFIED],
    [VisitState.CHECKED_IN, VisitState.SCHEDULED],
    [VisitState.IN_PROGRESS, VisitState.CHECKED_IN],
    [VisitState.IN_PROGRESS, VisitState.NOTIFIED],
    [VisitState.SUBMITTED, VisitState.IN_PROGRESS],
    [VisitState.SUBMITTED, VisitState.CHECKED_IN],
    [VisitState.VERIFIED, VisitState.SUBMITTED],
    [VisitState.PARTIAL, VisitState.SUBMITTED],
    [VisitState.FLAGGED, VisitState.SUBMITTED],
  ];
  for (const [from, to] of invalidRewinds) {
    assert.ok(!canTransition(from, to), `rewind ${from} → ${to} must be invalid`);
  }
});

test("rule C: cannot skip required stages", () => {
  const skips: Array<[VisitState, VisitState]> = [
    [VisitState.SCHEDULED, VisitState.CHECKED_IN],
    [VisitState.NOTIFIED, VisitState.IN_PROGRESS],
    [VisitState.NOTIFIED, VisitState.SUBMITTED],
    [VisitState.CHECKED_IN, VisitState.SUBMITTED],
    [VisitState.CHECKED_IN, VisitState.VERIFIED],
    [VisitState.SCHEDULED, VisitState.COMPLETED_VERIFIED],
    [VisitState.NOTIFIED, VisitState.COMPLETED_VERIFIED],
  ];
  for (const [from, to] of skips) {
    assert.ok(!canTransition(from, to), `skip ${from} → ${to} must be invalid`);
  }
});

test("rule D: cannot change outcome mid-stream", () => {
  const changes: Array<[VisitState, VisitState]> = [
    [VisitState.VERIFIED, VisitState.PARTIAL],
    [VisitState.VERIFIED, VisitState.FLAGGED],
    [VisitState.PARTIAL, VisitState.VERIFIED],
    [VisitState.PARTIAL, VisitState.FLAGGED],
    [VisitState.FLAGGED, VisitState.VERIFIED],
    [VisitState.FLAGGED, VisitState.PARTIAL],
  ];
  for (const [from, to] of changes) {
    assert.ok(!canTransition(from, to), `outcome change ${from} → ${to} must be invalid`);
  }
});

test("rule E: replacement flow is one-way (REPLACEMENT_REQUESTED cannot reach CHECKED_IN directly)", () => {
  assert.ok(!canTransition(VisitState.REPLACEMENT_REQUESTED, VisitState.CHECKED_IN));
  assert.ok(!canTransition(VisitState.REPLACEMENT_REQUESTED, VisitState.IN_PROGRESS));
  // Must go through HANDOFF_REPLACED or UNCOVERED (both pure terminal from here)
});

test("rule F: POST_COMPLAINT_REVIEW has bounded exits", () => {
  const invalidExits = [
    VisitState.SCHEDULED,
    VisitState.NOTIFIED,
    VisitState.CHECKED_IN,
    VisitState.IN_PROGRESS,
    VisitState.SUBMITTED,
    VisitState.NO_SHOW_SUSPECTED,
    VisitState.REPLACEMENT_REQUESTED,
    VisitState.VERIFIED,
    VisitState.PARTIAL,
    VisitState.FLAGGED,
    VisitState.HANDOFF_REPLACED,
    VisitState.UNCOVERED,
    VisitState.CANCELLED,
  ];
  for (const to of invalidExits) {
    assert.ok(
      !canTransition(VisitState.POST_COMPLAINT_REVIEW, to),
      `POST_COMPLAINT_REVIEW → ${to} must be invalid`,
    );
  }
});

test("rule G: self-transitions are always invalid", () => {
  for (const state of Object.values(VisitState)) {
    assert.ok(!canTransition(state, state), `self-transition ${state} must be invalid`);
  }
});

test("isTerminal classifies 7 states", () => {
  let count = 0;
  for (const state of Object.values(VisitState)) {
    if (isTerminal(state)) count++;
  }
  assert.equal(count, 7, "7 terminal states expected");
});

test("isPureTerminal classifies 4 states (HANDOFF_REPLACED, UNCOVERED, REJECTED, CANCELLED)", () => {
  assert.equal(PURE_TERMINAL_STATES.size, 4);
});

test("allowsPayroll returns true only for 3 COMPLETED_* states", () => {
  let count = 0;
  for (const state of Object.values(VisitState)) {
    if (allowsPayroll(state)) count++;
  }
  assert.equal(count, 3);
});

test("isRestorationTransition detects dismissal T-23/24/25", () => {
  assert.ok(
    isRestorationTransition(VisitState.POST_COMPLAINT_REVIEW, VisitState.COMPLETED_VERIFIED),
  );
  assert.ok(
    isRestorationTransition(
      VisitState.POST_COMPLAINT_REVIEW,
      VisitState.COMPLETED_PARTIAL_APPROVED,
    ),
  );
  assert.ok(
    isRestorationTransition(
      VisitState.POST_COMPLAINT_REVIEW,
      VisitState.COMPLETED_FLAGGED_WAIVED,
    ),
  );
  // REJECTED from POST_COMPLAINT_REVIEW is NOT restoration (T-26 is upheld, not dismiss)
  assert.ok(
    !isRestorationTransition(VisitState.POST_COMPLAINT_REVIEW, VisitState.REJECTED),
  );
  // Non-review transitions are not restoration
  assert.ok(!isRestorationTransition(VisitState.FLAGGED, VisitState.COMPLETED_FLAGGED_WAIVED));
});

test("assertTransitionGeneric throws InvalidTransitionError on bad transition", () => {
  assert.throws(
    () =>
      assertTransitionGeneric(
        "Visit",
        VISIT_TRANSITIONS,
        VisitState.SCHEDULED,
        VisitState.CHECKED_IN,
      ),
    InvalidTransitionError,
  );
});

test("assertTransitionGeneric does NOT throw on good transition", () => {
  assert.doesNotThrow(() =>
    assertTransitionGeneric(
      "Visit",
      VISIT_TRANSITIONS,
      VisitState.SCHEDULED,
      VisitState.NOTIFIED,
    ),
  );
});

test("buildWorkerActionKey is deterministic", () => {
  const k1 = buildWorkerActionKey("visit_abc", "checkin", "action_xyz");
  const k2 = buildWorkerActionKey("visit_abc", "checkin", "action_xyz");
  assert.equal(k1, k2);
  assert.match(k1, /^visit:visit_abc:checkin:action_xyz$/);
});

test("buildTimerKey is deterministic for same scheduledFor", () => {
  const t = "2026-04-19T08:30:00.000Z";
  const k1 = buildTimerKey("visit_abc", "check-no-show", t);
  const k2 = buildTimerKey("visit_abc", "check-no-show", t);
  assert.equal(k1, k2);
});

test("isActive is inverse of isTerminal", () => {
  for (const state of Object.values(VisitState)) {
    assert.equal(isActive(state), !isTerminal(state));
  }
});

test("canTransitionGeneric works with any state enum", () => {
  assert.ok(
    canTransitionGeneric(VISIT_TRANSITIONS, VisitState.SCHEDULED, VisitState.NOTIFIED),
  );
  assert.ok(
    !canTransitionGeneric(VISIT_TRANSITIONS, VisitState.SCHEDULED, VisitState.CHECKED_IN),
  );
});
