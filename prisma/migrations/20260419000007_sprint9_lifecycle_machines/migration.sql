-- Migration: sprint9_lifecycle_machines
-- Adds the AssignmentConfig + Site lifecycle state machines.
--
-- Per @axhy/shared canonical definitions:
--   AssignmentConfigState (9 states) — src/state-machines/assignment-config.ts
--   SiteState             (14 states) — src/state-machines/site.ts
--
-- Nullable columns on existing tables:
--   Assignment.lifecycleState  (dual-write with legacy status; Sprint 10 retires)
--   Site.lifecycleState        (dual-write with legacy isActive; Sprint 10 retires)
--
-- Two new event tables (same shape as AssignmentEvent) — events emitted
-- atomically alongside state updates inside transitionAssignmentConfig
-- and transitionSite helpers.

-- 1. Enum types --------------------------------------------------------------
CREATE TYPE "AssignmentConfigState" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'WORKER_ON_LEAVE',
  'WORKER_DEPARTED',
  'SITE_PAUSED',
  'REASSIGNMENT_NEEDED',
  'INACTIVE',
  'DISCARDED'
);

CREATE TYPE "SiteState" AS ENUM (
  'PROSPECT',
  'ONBOARDING',
  'PROBATION',
  'STABLE',
  'EARLY_RISK',
  'AT_RISK',
  'RENEWAL_WINDOW',
  'CONTRACT_EXPANDED',
  'PAUSED',
  'CHURNING',
  'CANCELLED_EARLY',
  'CANCELLED_PROBATION',
  'TERMINATED',
  'LOST_SITE'
);

-- 2. Lifecycle columns -------------------------------------------------------
ALTER TABLE "Assignment"
  ADD COLUMN "lifecycleState" "AssignmentConfigState";

CREATE INDEX "Assignment_lifecycleState_idx" ON "Assignment" ("lifecycleState");

ALTER TABLE "Site"
  ADD COLUMN "lifecycleState" "SiteState";

CREATE INDEX "Site_lifecycleState_idx" ON "Site" ("lifecycleState");

-- 3. AssignmentConfigEvent ---------------------------------------------------
CREATE TABLE "AssignmentConfigEvent" (
  "id"             TEXT         NOT NULL,
  "assignmentId"   TEXT         NOT NULL,
  "eventType"      TEXT         NOT NULL,
  "payload"        JSONB,
  "actorType"      TEXT         NOT NULL,
  "actorId"        TEXT,
  "idempotencyKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssignmentConfigEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssignmentConfigEvent_idempotencyKey_key"
  ON "AssignmentConfigEvent" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX "AssignmentConfigEvent_assignmentId_idx" ON "AssignmentConfigEvent" ("assignmentId");
CREATE INDEX "AssignmentConfigEvent_createdAt_idx"    ON "AssignmentConfigEvent" ("createdAt");

ALTER TABLE "AssignmentConfigEvent"
  ADD CONSTRAINT "AssignmentConfigEvent_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. SiteLifecycleEvent ------------------------------------------------------
CREATE TABLE "SiteLifecycleEvent" (
  "id"             TEXT         NOT NULL,
  "siteId"         TEXT         NOT NULL,
  "eventType"      TEXT         NOT NULL,
  "payload"        JSONB,
  "actorType"      TEXT         NOT NULL,
  "actorId"        TEXT,
  "idempotencyKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SiteLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteLifecycleEvent_idempotencyKey_key"
  ON "SiteLifecycleEvent" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX "SiteLifecycleEvent_siteId_idx"    ON "SiteLifecycleEvent" ("siteId");
CREATE INDEX "SiteLifecycleEvent_createdAt_idx" ON "SiteLifecycleEvent" ("createdAt");

ALTER TABLE "SiteLifecycleEvent"
  ADD CONSTRAINT "SiteLifecycleEvent_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
