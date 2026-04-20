-- Migration: add REACTIVATE_WORKER and DEACTIVATE_WORKER to AuditAction enum
-- These are used by the admin portal to audit every worker activation-state change.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REACTIVATE_WORKER';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DEACTIVATE_WORKER';
