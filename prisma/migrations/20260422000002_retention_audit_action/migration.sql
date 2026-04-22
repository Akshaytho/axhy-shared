-- Track K: Automated retention enforcement
-- Adds RETENTION_CLEANUP to the AuditAction enum so the daily retention
-- cron can write AdminAuditLog rows for its housekeeping actions.
--
-- Postgres enum additions are forward-only — no rollback without DROP+RECREATE.
-- Mitigation: the retention job is idempotent; disabling the cron is
-- sufficient to halt all new writes without touching the schema.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RETENTION_CLEANUP';
