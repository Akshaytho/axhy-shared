-- v1.12 / B?: Site contract window (contractStartDate, contractEndDate)
-- Adds two nullable DATE columns to Site. Both optional — admins enter
-- start at onboarding and may leave end null for open-ended contracts.
-- Used by /assignments for "contract ending soon" surfacing and by the
-- RENEWAL_WINDOW state transition to carry the queryable end date
-- instead of hiding it in SiteLifecycleEvent.payload.
--
-- Non-destructive migration: new nullable columns only, no drops, no
-- defaults needed (backfill is a separate admin-side flow per site).
-- Safe to apply to production without downtime.

ALTER TABLE "Site"
  ADD COLUMN "contractStartDate" DATE,
  ADD COLUMN "contractEndDate" DATE;
