-- Migration: idempotency_deadlines
-- Adds idempotency key tracking on AssignmentEvent, deadline scheduling fields
-- on SiteVisit, complaint-review preservation flag on SiteVisit, and structured
-- rejection metadata on Assignment.

-- ─── AssignmentEvent: idempotency key ─────────────────────────────────────────
-- Every state transition writes exactly one event; idempotencyKey guarantees
-- the same logical action (worker checkin retry, timer replay, admin
-- double-click) collapses to one row.
ALTER TABLE "AssignmentEvent"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentEvent_idempotencyKey_key"
  ON "AssignmentEvent" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- ─── SiteVisit: deadline scheduling ───────────────────────────────────────────
-- BullMQ writes the next expected deadline here so backup-sweep can detect
-- missed-timer events.
ALTER TABLE "SiteVisit"
  ADD COLUMN IF NOT EXISTS "nextDeadlineAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextDeadlineJobId" TEXT,
  ADD COLUMN IF NOT EXISTS "nextDeadlineKind"  TEXT;

CREATE INDEX IF NOT EXISTS "SiteVisit_nextDeadlineAt_idx"
  ON "SiteVisit" ("nextDeadlineAt");

-- ─── SiteVisit: complaint-review preservation ────────────────────────────────
-- When a visit cycles through POST_COMPLAINT_REVIEW and is restored to its
-- original completion state (T-23/T-24/T-25), postComplaintReviewed remains
-- true permanently. Filters like "completed visits with no review history"
-- use this flag, not state alone.
ALTER TABLE "SiteVisit"
  ADD COLUMN IF NOT EXISTS "postComplaintReviewed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "postComplaintOutcome"  TEXT;

CREATE INDEX IF NOT EXISTS "SiteVisit_postComplaintReviewed_idx"
  ON "SiteVisit" ("postComplaintReviewed")
  WHERE "postComplaintReviewed" = true;

-- ─── Assignment: structured rejection metadata ───────────────────────────────
-- Captures WHY a visit was rejected (T-19 / T-26). Duplicated on AssignmentEvent
-- payload, stored here for convenience queries and audit redundancy.
ALTER TABLE "Assignment"
  ADD COLUMN IF NOT EXISTS "rejectionReason" "RejectionReason",
  ADD COLUMN IF NOT EXISTS "rejectionDetail" TEXT;
