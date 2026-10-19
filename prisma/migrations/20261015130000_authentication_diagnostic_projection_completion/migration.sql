-- Explicit processing marker distinguishes valid missing historical metadata from unfinished projection.
SET lock_timeout = '5s';
ALTER TABLE "UserDevice" ADD COLUMN "sessionDiagnosticProjectedAt" TIMESTAMP(3);
-- The pending-work index is created concurrently by prepare-authentication-diagnostics.cjs.
