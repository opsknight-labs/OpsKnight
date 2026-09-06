DROP INDEX IF EXISTS "Service_slackIntegrationId_key";

CREATE INDEX IF NOT EXISTS "Service_slackIntegrationId_idx"
ON "Service"("slackIntegrationId");

ALTER TABLE "Service"
DROP CONSTRAINT IF EXISTS "Service_slackIntegrationId_fkey";

ALTER TABLE "Service"
ADD CONSTRAINT "Service_slackIntegrationId_fkey"
FOREIGN KEY ("slackIntegrationId") REFERENCES "SlackIntegration"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "InAppNotification_createdAt_idx"
ON "InAppNotification"("createdAt");

ALTER TABLE "cron_scheduler_state"
ADD COLUMN IF NOT EXISTS "lastRollupRefreshAt" TIMESTAMP(3);

ALTER TABLE "EscalationRule"
DROP CONSTRAINT IF EXISTS "EscalationRule_policyId_fkey";
ALTER TABLE "EscalationRule"
ADD CONSTRAINT "EscalationRule_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "EscalationPolicy"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_providerMessageId_key"
ON "Notification"("providerMessageId");
