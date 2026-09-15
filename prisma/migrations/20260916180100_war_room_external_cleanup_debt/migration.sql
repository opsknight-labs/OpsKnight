-- Terminal drift debt: track unverified external creates that must be reconciled asynchronously.
-- When the 15-minute reconciliation window expires with createAttemptedAt set but provider
-- identity still unresolved, we close locally as DEGRADED and persist this debt so a
-- low-frequency orphan lane can scan the provider by marker/planned name and archive
-- any late-created channel idempotently without reopening the DB lifecycle.
ALTER TABLE "IncidentWarRoom" ADD COLUMN IF NOT EXISTS "externalCleanupPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IncidentWarRoom" ADD COLUMN IF NOT EXISTS "externalCleanupReason" TEXT;
ALTER TABLE "IncidentWarRoom" ADD COLUMN IF NOT EXISTS "externalCleanupLastAttemptAt" TIMESTAMP(3);
ALTER TABLE "IncidentWarRoom" ADD COLUMN IF NOT EXISTS "externalCleanupCompletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "IncidentWarRoom_state_health_externalCleanupPending_lastReconciledAt_idx"
  ON "IncidentWarRoom"("state", "health", "externalCleanupPending", "lastReconciledAt");
