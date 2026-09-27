-- Migration: add partial indexes to NotificationDeliveryAttempt for voice reconciliation
-- and status-route lookup performance.
--
-- Both indexes are created with CONCURRENTLY so they do not take an exclusive lock
-- and are safe to apply to a live production database with zero downtime.
--
-- idx_attempt_open_voice
--   Partial index on (notificationId, outcome) WHERE finishedAt IS NULL.
--   Speeds up the reconciler's sub-query that finds notifications with at least one
--   open voice attempt (status IN ('ACCEPTED','IN_FLIGHT','RINGING','IN-PROGRESS','ANSWERED')).
--   Without this index the query performs a sequential scan of all attempts.
--
-- idx_attempt_provider_msg_id
--   Partial index on (providerMessageId) WHERE providerMessageId IS NOT NULL.
--   Speeds up the Twilio status-route point lookup by Call SID.
--   The existing @@unique on Notification.providerMessageId is a different table/column;
--   this index covers the attempt-level SID stored in NotificationDeliveryAttempt.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_attempt_open_voice"
  ON "NotificationDeliveryAttempt" ("notificationId", "outcome")
  WHERE "finishedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_attempt_provider_msg_id"
  ON "NotificationDeliveryAttempt" ("providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;
