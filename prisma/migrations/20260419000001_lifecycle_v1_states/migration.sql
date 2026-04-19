-- Migration: lifecycle_v1_states
-- Extends LifecycleStatus with the 18 locked VisitState values (keeping legacy
-- ASSIGNED+CLOSED for backfill). Creates RejectionReason enum for structured
-- metadata on T-19/T-26 rejection events.
--
-- Notes:
--   * ASSIGNED is the legacy alias for SCHEDULED. Application code reads both.
--   * CLOSED is the legacy pre-split terminal; rows with CLOSED are backfilled
--     later (sprint 6) based on their VerificationOutcome.
--   * ALTER TYPE ... ADD VALUE must run outside a transaction when the new
--     values will be used in the same transaction. We are ONLY adding values
--     here, not using them, so it runs inside the migration's default txn.

-- ─── LifecycleStatus additions ────────────────────────────────────────────────
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'NOTIFIED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW_SUSPECTED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'REPLACEMENT_REQUESTED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'HANDOFF_REPLACED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'UNCOVERED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'FLAGGED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'COMPLETED_VERIFIED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'COMPLETED_PARTIAL_APPROVED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'COMPLETED_FLAGGED_WAIVED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'POST_COMPLAINT_REVIEW';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ─── RejectionReason enum (new) ───────────────────────────────────────────────
-- Structured metadata on Assignment for T-19 + T-26 rejection transitions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RejectionReason') THEN
    CREATE TYPE "RejectionReason" AS ENUM (
      'FRAUD',
      'QUALITY_UNACCEPTABLE',
      'EVIDENCE_INSUFFICIENT',
      'WRONG_SITE',
      'CLIENT_COMPLAINT_UPHELD',
      'POLICY_VIOLATION',
      'INCOMPLETE_WORK',
      'TIME_WINDOW_MISSED',
      'OTHER'
    );
  END IF;
END
$$;
