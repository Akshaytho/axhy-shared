-- Migration: sprint8_lifecycle_machines
-- Adds SwapRequest / Worker / Device lifecycle state machines.
--
-- Per @axhy/shared canonical definitions:
--   - SwapRequestState (14 states) — src/state-machines/swap-request.ts
--   - WorkerState       (15 states) — src/state-machines/worker.ts
--   - DeviceState       (10 states) — src/state-machines/device.ts
--
-- New columns on existing tables:
--   SwapRequest.lifecycleState (nullable; backfill-safe — dual-write with status)
--   "User".lifecycleState      (nullable; worker lifecycle)
--   "User".deviceState         (nullable; device lifecycle)
--
-- New event tables mirror AssignmentEvent: state update + event row written
-- atomically inside the transition helper. idempotencyKey dedupes retries.

-- 1. Create Postgres enum types -----------------------------------------------
CREATE TYPE "SwapRequestState" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'PENDING_PARTNER',
  'PENDING_ADMIN',
  'PARTNER_ACCEPTED',
  'PARTNER_DECLINED',
  'PARTNER_TIMEOUT',
  'APPROVED_IMMEDIATE',
  'APPROVED_PLANNED',
  'EXECUTED',
  'EXECUTION_FAILED',
  'DENIED',
  'CANCELLED',
  'ABANDONED'
);

CREATE TYPE "WorkerState" AS ENUM (
  'APPLICANT',
  'SCREENING',
  'ONBOARDING',
  'PROBATION',
  'EXTENDED_PROBATION',
  'ACTIVE',
  'COACHING',
  'ON_LEAVE',
  'SUSPENDED_INVESTIGATION',
  'ABSENT_UNAUTHORIZED',
  'RESIGNING',
  'TERMINATED',
  'TERMINATED_PROBATION',
  'DEPARTED',
  'REJECTED_APPLICANT'
);

CREATE TYPE "DeviceState" AS ENUM (
  'REGISTERED',
  'VERIFIED',
  'ACTIVE',
  'FLAKY',
  'OFFLINE',
  'BROKEN',
  'UNINSTALLED',
  'REPLACED',
  'STALE',
  'WORKER_DEPARTED'
);

-- 2. Add lifecycleState to SwapRequest ----------------------------------------
ALTER TABLE "SwapRequest"
  ADD COLUMN "lifecycleState" "SwapRequestState";

CREATE INDEX "SwapRequest_lifecycleState_idx" ON "SwapRequest" ("lifecycleState");

-- 3. Add worker + device lifecycle to User ------------------------------------
ALTER TABLE "User"
  ADD COLUMN "lifecycleState" "WorkerState",
  ADD COLUMN "deviceState"    "DeviceState";

CREATE INDEX "User_lifecycleState_idx" ON "User" ("lifecycleState");
CREATE INDEX "User_deviceState_idx"    ON "User" ("deviceState");

-- 4. SwapRequestEvent ---------------------------------------------------------
CREATE TABLE "SwapRequestEvent" (
  "id"             TEXT        NOT NULL,
  "swapRequestId"  TEXT        NOT NULL,
  "eventType"      TEXT        NOT NULL,
  "payload"        JSONB,
  "actorType"      TEXT        NOT NULL,
  "actorId"        TEXT,
  "idempotencyKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SwapRequestEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SwapRequestEvent_idempotencyKey_key"
  ON "SwapRequestEvent" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX "SwapRequestEvent_swapRequestId_idx" ON "SwapRequestEvent" ("swapRequestId");
CREATE INDEX "SwapRequestEvent_createdAt_idx"     ON "SwapRequestEvent" ("createdAt");

ALTER TABLE "SwapRequestEvent"
  ADD CONSTRAINT "SwapRequestEvent_swapRequestId_fkey"
    FOREIGN KEY ("swapRequestId") REFERENCES "SwapRequest" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. WorkerLifecycleEvent -----------------------------------------------------
CREATE TABLE "WorkerLifecycleEvent" (
  "id"             TEXT        NOT NULL,
  "userId"         TEXT        NOT NULL,
  "eventType"      TEXT        NOT NULL,
  "payload"        JSONB,
  "actorType"      TEXT        NOT NULL,
  "actorId"        TEXT,
  "idempotencyKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkerLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerLifecycleEvent_idempotencyKey_key"
  ON "WorkerLifecycleEvent" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX "WorkerLifecycleEvent_userId_idx"    ON "WorkerLifecycleEvent" ("userId");
CREATE INDEX "WorkerLifecycleEvent_createdAt_idx" ON "WorkerLifecycleEvent" ("createdAt");

ALTER TABLE "WorkerLifecycleEvent"
  ADD CONSTRAINT "WorkerLifecycleEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. DeviceLifecycleEvent -----------------------------------------------------
CREATE TABLE "DeviceLifecycleEvent" (
  "id"             TEXT        NOT NULL,
  "userId"         TEXT        NOT NULL,
  "eventType"      TEXT        NOT NULL,
  "payload"        JSONB,
  "actorType"      TEXT        NOT NULL,
  "actorId"        TEXT,
  "idempotencyKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DeviceLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceLifecycleEvent_idempotencyKey_key"
  ON "DeviceLifecycleEvent" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX "DeviceLifecycleEvent_userId_idx"    ON "DeviceLifecycleEvent" ("userId");
CREATE INDEX "DeviceLifecycleEvent_createdAt_idx" ON "DeviceLifecycleEvent" ("createdAt");

ALTER TABLE "DeviceLifecycleEvent"
  ADD CONSTRAINT "DeviceLifecycleEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
