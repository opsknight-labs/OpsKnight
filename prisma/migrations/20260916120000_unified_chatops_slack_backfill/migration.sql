-- Adopt legacy Slack war rooms into the provider-neutral authority.
--
-- This migration is intentionally additive and idempotent. Existing
-- IncidentWarRoom rows are authoritative and are never overwritten. The
-- legacy Incident columns remain in place as a compatibility projection for
-- rolling deploys and downgrade safety.
INSERT INTO "IncidentWarRoom" (
  "id",
  "incidentId",
  "provider",
  "generation",
  "state",
  "providerTenantId",
  "providerChannelId",
  "providerChannelName",
  "providerChannelUrl",
  "readyAt",
  "closedAt",
  "archivedAt",
  "metadata",
  "createdAt",
  "updatedAt"
)
SELECT
  'slack-backfill-' || md5(incident."id"),
  incident."id",
  'SLACK'::"WarRoomProvider",
  1,
  CASE
    WHEN incident."warRoomArchivedAt" IS NOT NULL THEN 'ARCHIVED'::"WarRoomState"
    WHEN incident."status" = 'RESOLVED' THEN 'CLOSED'::"WarRoomState"
    ELSE 'READY'::"WarRoomState"
  END,
  incident."slackWorkspaceId",
  incident."slackChannelId",
  incident."slackChannelName",
  incident."warRoomUrl",
  incident."createdAt",
  CASE
    WHEN incident."warRoomArchivedAt" IS NOT NULL THEN incident."warRoomArchivedAt"
    WHEN incident."status" = 'RESOLVED' THEN incident."resolvedAt"
    ELSE NULL
  END,
  incident."warRoomArchivedAt",
  jsonb_build_object(
    'migration', 'unified-chatops-slack-backfill',
    'legacyProjection', true
  ),
  incident."createdAt",
  incident."updatedAt"
FROM "Incident" AS incident
WHERE incident."slackChannelId" IS NOT NULL
ON CONFLICT ("incidentId", "provider", "generation") DO NOTHING;
