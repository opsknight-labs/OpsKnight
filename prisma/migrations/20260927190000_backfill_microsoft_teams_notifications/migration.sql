-- Backfill historical ExternalOperation records for MICROSOFT_TEAMS into the Notification table
-- Guarantees idempotency via ON CONFLICT ("deliveryKey") DO NOTHING
INSERT INTO "Notification" (
  "id",
  "channel",
  "status",
  "category",
  "recipientType",
  "recipientId",
  "recipientDisplay",
  "recipientHash",
  "incidentId",
  "eventType",
  "message",
  "templateKey",
  "sourceType",
  "sourceId",
  "deliveryKey",
  "providerMessageId",
  "errorMsg",
  "attempts",
  "sentAt",
  "deliveredAt",
  "failedAt",
  "createdAt",
  "scheduledAt",
  "nextAttemptAt",
  "trafficClass",
  "tenantKey",
  "priority",
  "maxAttempts"
)
SELECT
  'notif_eo_' || id,
  'MICROSOFT_TEAMS'::"NotificationChannel",
  CASE
    WHEN status = 'COMPLETED' THEN 'DELIVERED'::"NotificationStatus"
    WHEN status = 'FAILED' THEN 'FAILED'::"NotificationStatus"
    ELSE 'PENDING'::"NotificationStatus"
  END,
  'INCIDENT'::"NotificationCategory",
  'MICROSOFT_TEAMS_CHANNEL'::"NotificationRecipientType",
  COALESCE(("requestPayload"::jsonb)->>'destinationId', id),
  COALESCE(("requestPayload"::jsonb)->'destinationSnapshot'->>'channelId', ("requestPayload"::jsonb)->>'destinationId', 'Teams Channel'),
  encode(sha256(('MICROSOFT_TEAMS:' || COALESCE(("requestPayload"::jsonb)->>'destinationId', id))::bytea), 'hex'),
  "incidentId",
  COALESCE(("requestPayload"::jsonb)->>'eventType', 'triggered'),
  'Teams card (' || COALESCE(("requestPayload"::jsonb)->>'eventType', 'triggered') || ')',
  'service-teams-' || COALESCE(("requestPayload"::jsonb)->>'eventType', 'triggered'),
  'SERVICE_INCIDENT',
  COALESCE(("requestPayload"::jsonb)->>'destinationId', id),
  "idempotencyKey",
  CASE WHEN "externalId" IS NOT NULL THEN ('teams:' || id) ELSE NULL END,
  "lastError",
  attempts,
  CASE WHEN status = 'COMPLETED' THEN "updatedAt" ELSE NULL END,
  CASE WHEN status = 'COMPLETED' THEN "updatedAt" ELSE NULL END,
  CASE WHEN status = 'FAILED' THEN "updatedAt" ELSE NULL END,
  "createdAt",
  "createdAt",
  "nextAttemptAt",
  'TRANSACTIONAL'::"NotificationTrafficClass",
  'system',
  5,
  3
FROM "ExternalOperation"
WHERE provider = 'MICROSOFT_TEAMS'
ON CONFLICT ("deliveryKey") DO NOTHING;
