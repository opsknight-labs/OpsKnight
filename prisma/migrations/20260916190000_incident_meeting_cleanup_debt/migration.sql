-- AlterTable
ALTER TABLE "IncidentMeeting" ADD COLUMN IF NOT EXISTS "closeStartedAt" TIMESTAMP(3);
ALTER TABLE "IncidentMeeting" ADD COLUMN IF NOT EXISTS "cleanupAttemptedAt" TIMESTAMP(3);
ALTER TABLE "IncidentMeeting" ADD COLUMN IF NOT EXISTS "lastReconciledAt" TIMESTAMP(3);
ALTER TABLE "IncidentMeeting" ADD COLUMN IF NOT EXISTS "externalCleanupPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IncidentMeeting_state_health_externalCleanupPending_lastReconciledAt_idx" ON "IncidentMeeting"("state", "health", "externalCleanupPending", "lastReconciledAt");
CREATE INDEX IF NOT EXISTS "IncidentMeeting_state_provisioningStartedAt_idx" ON "IncidentMeeting"("state", "provisioningStartedAt");
