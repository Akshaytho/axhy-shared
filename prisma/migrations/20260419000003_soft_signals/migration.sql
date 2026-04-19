-- Migration: soft_signals
-- Creates the SoftSignal table for unreliable-signal telemetry that DOES NOT
-- drive state transitions (per LOCKED v1.1 design rule 1).
--
-- Signals currently written here:
--   - NOTIFICATION_ACK  — worker opened a push / foregrounded the app while
--                         a visit notification was active
--   - LOCATION_PING     — foreground-permitted location update (no background
--                         GPS — too unreliable for state)
--   - APP_FOREGROUND    — app came to foreground while a visit is NOTIFIED
--
-- Schema principles:
--   - Never blocks a transition. Failure to write is a warning, not an error.
--   - Keyed by (visitId, kind, clientTimestamp) to dedupe retries.
--   - Cheap to query per visit for the attention-queue derived view.
--   - Retained for 90 days then swept; not critical audit data.

CREATE TABLE IF NOT EXISTS "SoftSignal" (
  "id"              TEXT                     NOT NULL DEFAULT gen_random_uuid(),
  "visitId"         TEXT                     NOT NULL,
  "kind"            TEXT                     NOT NULL,
  "clientTimestamp" TIMESTAMP(3)             NOT NULL,
  "receivedAt"      TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deviceId"        TEXT,
  "actorId"         TEXT,
  "actorType"       TEXT,
  "payload"         JSONB,
  CONSTRAINT "SoftSignal_pkey" PRIMARY KEY ("id")
);

-- Dedupe retries: same visit + kind + clientTimestamp collapses to one row.
CREATE UNIQUE INDEX IF NOT EXISTS "SoftSignal_visit_kind_ts_key"
  ON "SoftSignal" ("visitId", "kind", "clientTimestamp");

-- Common query: "all signals for visit X"
CREATE INDEX IF NOT EXISTS "SoftSignal_visitId_idx"
  ON "SoftSignal" ("visitId");

-- Common query: "recent signals of a kind" for analytics
CREATE INDEX IF NOT EXISTS "SoftSignal_kind_receivedAt_idx"
  ON "SoftSignal" ("kind", "receivedAt" DESC);

-- FK to SiteVisit — enforce referential integrity
ALTER TABLE "SoftSignal"
  ADD CONSTRAINT "SoftSignal_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "SiteVisit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
