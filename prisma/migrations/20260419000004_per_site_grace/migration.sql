-- Migration: per_site_grace
-- Adds per-site grace period and geofence radius settings. Required for
-- Sprint 4's no-show detection job: the check-no-show deadline fires at
-- `visit.scheduledStart + site.checkinGraceMinutes`, so each site can
-- configure its own tolerance based on building access patterns.
--
-- Defaults (30 min grace, 500 m geofence) match the historical constants
-- hard-coded in backend's sites.service.ts — existing rows read the same
-- numbers they were using before, just from the DB instead of a constant.

ALTER TABLE "Site"
  ADD COLUMN IF NOT EXISTS "checkinGraceMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "geofenceRadiusM"    INTEGER NOT NULL DEFAULT 500;
