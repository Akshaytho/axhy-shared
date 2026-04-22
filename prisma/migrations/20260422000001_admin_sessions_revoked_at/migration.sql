-- Security P1.9: JWT revocation watermark on AdminUser.
-- Any JWT with `iat` older than this timestamp is rejected at the session-
-- validation layer. Used on logout + password reset + compromise response.
--
-- Nullable so existing rows can adopt the schema without backfill; NULL
-- means "no revocation has occurred yet", treated as always-valid in code.

ALTER TABLE "AdminUser"
  ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
