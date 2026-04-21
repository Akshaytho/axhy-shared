-- Sprint 4: Cross-week one-off assignments
-- Adds oneOffDates column to Assignment table and ONE_OFF value to AssignmentSource enum.
--
-- The ADD VALUE IF NOT EXISTS form is idempotent and safe in Postgres 11+.
-- It cannot be run inside a transaction, so we use a separate migration.

ALTER TYPE "AssignmentSource" ADD VALUE IF NOT EXISTS 'ONE_OFF';

ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "oneOffDates" TIMESTAMP(3)[] NOT NULL DEFAULT ARRAY[]::TIMESTAMP(3)[];
