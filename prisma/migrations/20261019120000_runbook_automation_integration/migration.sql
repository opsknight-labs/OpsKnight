-- Runbook ↔ Service Automation integration. All changes are additive and metadata-only.

ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RUNBOOK_SKIPPED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RUNBOOK_VERIFIED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RUNBOOK_UNVERIFIED';
ALTER TYPE "RunbookConditionOperator" ADD VALUE IF NOT EXISTS 'IS_MISSING';
ALTER TYPE "RunbookConditionOperator" ADD VALUE IF NOT EXISTS 'IS_UNMAPPED';

-- Existing AUTOMATIC bindings are intentionally NOT backfilled with an authorization:
-- their unattended write steps wait for responder approval until an administrator
-- explicitly authorizes the pinned version.
ALTER TABLE "ServiceRunbookBinding"
  ADD COLUMN "resolveOnVerifiedRecovery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unattendedWritesVersionId" TEXT,
  ADD COLUMN "unattendedWritesAuthorizedById" TEXT,
  ADD COLUMN "unattendedWritesAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN "unattendedWritesScopeHash" TEXT,
  ADD COLUMN "runOnMonitoringIncidents" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contextInputMappings" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "contextTargetMappings" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "ServiceRunbookBinding"
  ADD CONSTRAINT "ServiceRunbookBinding_unattendedWritesAuthorizedById_fkey"
  FOREIGN KEY ("unattendedWritesAuthorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RunbookExecution"
  ADD COLUMN "responseContext" JSONB,
  ADD COLUMN "unattendedWritesAuthorized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recoveryOutcome" TEXT,
  ADD COLUMN "recoveryCheckedAt" TIMESTAMP(3),
  ADD COLUMN "executionPlan" JSONB;
