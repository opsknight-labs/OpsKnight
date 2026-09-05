-- A war-room belongs to the Slack workspace in which it was created, not to
-- the service's current integration. This preserves correct historical event
-- routing after a service reconnects to a different workspace.
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "slackWorkspaceId" TEXT;

CREATE INDEX IF NOT EXISTS "idx_incident_war_room_workspace_channel"
ON "Incident"("slackWorkspaceId", "slackChannelId");

-- Populate only rows with a known war-room and a current installation. Legacy
-- rows without a trustworthy workspace intentionally remain NULL.
UPDATE "Incident" AS incident
SET "slackWorkspaceId" = integration."workspaceId"
FROM "Service" AS service
JOIN "SlackIntegration" AS integration ON integration.id = service."slackIntegrationId"
WHERE incident."serviceId" = service.id
  AND incident."slackChannelId" IS NOT NULL
  AND incident."slackWorkspaceId" IS NULL;

ALTER TABLE "SlackPinnedMessage" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

UPDATE "SlackPinnedMessage" AS pin
SET "workspaceId" = incident."slackWorkspaceId"
FROM "Incident" AS incident
WHERE pin."incidentId" = incident.id
  AND pin."workspaceId" IS NULL;

DROP INDEX IF EXISTS "SlackPinnedMessage_channelId_messageTs_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SlackPinnedMessage_workspaceId_channelId_messageTs_key"
ON "SlackPinnedMessage"("workspaceId", "channelId", "messageTs");
CREATE INDEX IF NOT EXISTS "SlackPinnedMessage_workspaceId_channelId_idx"
ON "SlackPinnedMessage"("workspaceId", "channelId");
