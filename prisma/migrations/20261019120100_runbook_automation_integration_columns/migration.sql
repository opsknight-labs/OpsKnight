-- Runbook ↔ Service Automation integration columns. Additive and metadata-only.

-- Existing AUTOMATIC bindings are intentionally NOT backfilled with an authorization:
-- their unattended write steps wait for responder approval until an administrator
-- explicitly authorizes the pinned version.
ALTER TABLE "ServiceRunbookBinding"
  ADD COLUMN IF NOT EXISTS "resolveOnVerifiedRecovery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "unattendedWritesVersionId" TEXT,
  ADD COLUMN IF NOT EXISTS "unattendedWritesAuthorizedById" TEXT,
  ADD COLUMN IF NOT EXISTS "unattendedWritesAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unattendedWritesScopeHash" TEXT,
  ADD COLUMN IF NOT EXISTS "runOnMonitoringIncidents" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "contextInputMappings" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "contextTargetMappings" JSONB NOT NULL DEFAULT '{}';

DO $$
BEGIN
  ALTER TABLE "ServiceRunbookBinding"
    ADD CONSTRAINT "ServiceRunbookBinding_unattendedWritesAuthorizedById_fkey"
    FOREIGN KEY ("unattendedWritesAuthorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "RunbookExecution"
  ADD COLUMN IF NOT EXISTS "responseContext" JSONB,
  ADD COLUMN IF NOT EXISTS "unattendedWritesAuthorized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "recoveryOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "executionPlan" JSONB;
