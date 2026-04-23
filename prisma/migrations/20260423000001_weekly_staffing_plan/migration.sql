-- Phase 5 / B30: Weekly Staffing Plan
-- Adds WeeklyStaffingPlan table for per-site per-date planned worker counts.
-- The night planner reads this table first and falls back to site.requiredWorkers
-- if no entry is found. Admin UI exposes a 14-day rolling grid for future-date edits.
--
-- Non-destructive migration: new table only, no drops, no column renames.
-- Safe to apply to production without downtime.

CREATE TABLE "WeeklyStaffingPlan" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "siteId"         TEXT NOT NULL,
    "date"           TIMESTAMP(3) NOT NULL,
    "workersPlanned" INTEGER NOT NULL,
    "confirmedBy"    TEXT,
    "confirmedAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyStaffingPlan_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one plan entry per (site, date)
CREATE UNIQUE INDEX "WeeklyStaffingPlan_siteId_date_key" ON "WeeklyStaffingPlan"("siteId", "date");

-- Index: efficient lookup by (company, date) for planner bulk-load queries
CREATE INDEX "WeeklyStaffingPlan_companyId_date_idx" ON "WeeklyStaffingPlan"("companyId", "date");

-- Foreign keys
ALTER TABLE "WeeklyStaffingPlan" ADD CONSTRAINT "WeeklyStaffingPlan_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WeeklyStaffingPlan" ADD CONSTRAINT "WeeklyStaffingPlan_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
