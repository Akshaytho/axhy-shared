-- Sprint 1 (no-work-days) and Sprint 5 (AI assistant) each need new
-- AuditAction values to distinguish their admin writes in AdminAuditLog.
--
-- Postgres enum value additions are forward-only — we cannot rollback
-- `ALTER TYPE … ADD VALUE` without dropping and recreating the type.
-- Mitigation: code paths that write these values land behind sprint
-- feature flags so behaviour is revertable without touching the schema.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CREATE_NO_WORK_DAY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELETE_NO_WORK_DAY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AI_TOOL_EXECUTED';
