-- Migration: legacy_state_backfill
-- Purpose : One-time data backfill that maps pre-state-machine legacy enum
--           values on SiteVisit.lifecycleStatus and Assignment.lifecycleState
--           to their v1.7.0+ canonical equivalents.
--
-- Safety  : All statements are idempotent — WHERE clauses narrow to rows that
--           have NOT yet been migrated, so re-running is a no-op.
--           Only UPDATE statements; no DROP / DELETE / column removals.
--           Column retirement (removing CLOSED, ASSIGNED from the enum and
--           dropping the legacy isActive column) is a separate later migration
--           after this backfill is verified in production.
--
-- Rollback: There is NO safe automated rollback.
--           CLOSED rows are disambiguated by verificationOutcome; once
--           overwritten with COMPLETED_* the original CLOSED state cannot be
--           recovered without restoring from a pre-migration backup.
--           ACTION: take a pg_dump snapshot before applying to production.
--
-- Sequence: 000008, follows 000007_sprint9_lifecycle_machines.

-- ─── Diagnostic counts (before) ───────────────────────────────────────────────

DO $$
DECLARE
  v_closed_verified  BIGINT;
  v_closed_partial   BIGINT;
  v_closed_flagged   BIGINT;
  v_closed_rejected  BIGINT;
  v_closed_pending   BIGINT;
  v_assigned         BIGINT;
  v_assign_active    BIGINT;
  v_assign_inactive  BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_closed_verified
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" = 'VERIFIED';

  SELECT COUNT(*) INTO v_closed_partial
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" = 'PARTIAL';

  SELECT COUNT(*) INTO v_closed_flagged
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" = 'FLAGGED';

  SELECT COUNT(*) INTO v_closed_rejected
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" = 'REJECTED';

  SELECT COUNT(*) INTO v_closed_pending
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" = 'PENDING';

  SELECT COUNT(*) INTO v_assigned
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'ASSIGNED';

  SELECT COUNT(*) INTO v_assign_active
    FROM "Assignment"
    WHERE "lifecycleState" IS NULL AND "isActive" = true;

  SELECT COUNT(*) INTO v_assign_inactive
    FROM "Assignment"
    WHERE "lifecycleState" IS NULL AND "isActive" = false;

  RAISE NOTICE '[backfill 000008] PRE-COUNTS';
  RAISE NOTICE '  SiteVisit CLOSED+VERIFIED  → COMPLETED_VERIFIED          : %', v_closed_verified;
  RAISE NOTICE '  SiteVisit CLOSED+PARTIAL   → COMPLETED_PARTIAL_APPROVED  : %', v_closed_partial;
  RAISE NOTICE '  SiteVisit CLOSED+FLAGGED   → COMPLETED_FLAGGED_WAIVED    : %', v_closed_flagged;
  RAISE NOTICE '  SiteVisit CLOSED+REJECTED  → REJECTED                    : %', v_closed_rejected;
  RAISE NOTICE '  SiteVisit CLOSED+PENDING   → SKIPPED (manual review)     : %', v_closed_pending;
  RAISE NOTICE '  SiteVisit ASSIGNED         → SCHEDULED                   : %', v_assigned;
  RAISE NOTICE '  Assignment NULL+isActive=T → ACTIVE                      : %', v_assign_active;
  RAISE NOTICE '  Assignment NULL+isActive=F → INACTIVE                    : %', v_assign_inactive;
END
$$;

-- ─── 1. SiteVisit: CLOSED → COMPLETED_VERIFIED ────────────────────────────────
-- verificationOutcome='VERIFIED' means supervisor confirmed visit was done
-- correctly; maps cleanly to COMPLETED_VERIFIED.

UPDATE "SiteVisit"
SET    "lifecycleStatus" = 'COMPLETED_VERIFIED'
WHERE  "lifecycleStatus" = 'CLOSED'
  AND  "verificationOutcome" = 'VERIFIED';

-- ─── 2. SiteVisit: CLOSED → COMPLETED_PARTIAL_APPROVED ───────────────────────
-- verificationOutcome='PARTIAL' means supervisor accepted partial work;
-- COMPLETED_PARTIAL_APPROVED is the direct semantic equivalent.

UPDATE "SiteVisit"
SET    "lifecycleStatus" = 'COMPLETED_PARTIAL_APPROVED'
WHERE  "lifecycleStatus" = 'CLOSED'
  AND  "verificationOutcome" = 'PARTIAL';

-- ─── 3. SiteVisit: CLOSED → COMPLETED_FLAGGED_WAIVED ─────────────────────────
-- verificationOutcome='FLAGGED' on a CLOSED row implies the supervisor chose
-- to close despite the flag rather than reject — i.e. the flag was waived.
-- Assumption: FLAGGED+CLOSED = supervisor waived the issue; if a separate
-- "rejected after flag" outcome exists it would carry verificationOutcome=REJECTED.

UPDATE "SiteVisit"
SET    "lifecycleStatus" = 'COMPLETED_FLAGGED_WAIVED'
WHERE  "lifecycleStatus" = 'CLOSED'
  AND  "verificationOutcome" = 'FLAGGED';

-- ─── 4. SiteVisit: CLOSED → REJECTED ─────────────────────────────────────────
-- verificationOutcome='REJECTED' is terminal and the new enum has an identical
-- REJECTED state; direct 1-to-1 mapping, no semantic loss.

UPDATE "SiteVisit"
SET    "lifecycleStatus" = 'REJECTED'
WHERE  "lifecycleStatus" = 'CLOSED'
  AND  "verificationOutcome" = 'REJECTED';

-- NOTE: CLOSED rows with verificationOutcome='PENDING' are intentionally
-- skipped. They represent inconsistent data (closed without a verification
-- decision) and need manual triage. Their IDs are surfaced in the post-count
-- block below.

-- ─── 5. SiteVisit: ASSIGNED → SCHEDULED ──────────────────────────────────────
-- Pre-v1 rows used ASSIGNED to mean "assignment created, worker not yet
-- checked in". The new state machine uses SCHEDULED for the same slot.
-- Lossy mapping acknowledged: ASSIGNED carried no check-in timestamp whereas
-- SCHEDULED implies a generator-created row; for defunct legacy rows the
-- semantic difference is immaterial.

UPDATE "SiteVisit"
SET    "lifecycleStatus" = 'SCHEDULED'
WHERE  "lifecycleStatus" = 'ASSIGNED';

-- ─── 6. Assignment: NULL lifecycleState, isActive=true → ACTIVE ──────────────
-- Rows created before 000007 have no lifecycleState. isActive=true is the
-- legacy signal for an operationally active assignment.

UPDATE "Assignment"
SET    "lifecycleState" = 'ACTIVE'::"AssignmentConfigState"
WHERE  "lifecycleState" IS NULL
  AND  "isActive" = true;

-- ─── 7. Assignment: NULL lifecycleState, isActive=false → INACTIVE ────────────
-- isActive=false rows that were soft-deactivated without a formal state
-- machine transition map to INACTIVE (the closest terminal-but-retained state).

UPDATE "Assignment"
SET    "lifecycleState" = 'INACTIVE'::"AssignmentConfigState"
WHERE  "lifecycleState" IS NULL
  AND  "isActive" = false;

-- ─── Diagnostic counts (after) + flag skipped rows ───────────────────────────

DO $$
DECLARE
  v_still_closed_pending  BIGINT;
  v_still_closed_other    BIGINT;
  v_still_assigned        BIGINT;
  v_still_null_lifecycle  BIGINT;
  r                       RECORD;
BEGIN
  -- Any CLOSED rows that remain are the PENDING ones we deliberately skipped.
  SELECT COUNT(*) INTO v_still_closed_pending
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" = 'PENDING';

  SELECT COUNT(*) INTO v_still_closed_other
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" NOT IN ('PENDING');

  SELECT COUNT(*) INTO v_still_assigned
    FROM "SiteVisit"
    WHERE "lifecycleStatus" = 'ASSIGNED';

  SELECT COUNT(*) INTO v_still_null_lifecycle
    FROM "Assignment"
    WHERE "lifecycleState" IS NULL;

  RAISE NOTICE '[backfill 000008] POST-COUNTS';
  RAISE NOTICE '  SiteVisit still CLOSED+PENDING (skipped, manual review): %', v_still_closed_pending;
  RAISE NOTICE '  SiteVisit still CLOSED+other   (unexpected, investigate): %', v_still_closed_other;
  RAISE NOTICE '  SiteVisit still ASSIGNED        (should be 0)           : %', v_still_assigned;
  RAISE NOTICE '  Assignment still NULL lifecycle  (should be 0)          : %', v_still_null_lifecycle;

  -- Log IDs of CLOSED+PENDING rows so ops can triage them manually.
  IF v_still_closed_pending > 0 THEN
    RAISE NOTICE '[backfill 000008] SiteVisit IDs requiring manual review (CLOSED+PENDING):';
    FOR r IN
      SELECT id FROM "SiteVisit"
      WHERE "lifecycleStatus" = 'CLOSED' AND "verificationOutcome" = 'PENDING'
      ORDER BY "createdAt"
    LOOP
      RAISE NOTICE '  site_visit_id=%', r.id;
    END LOOP;
  END IF;
END
$$;
