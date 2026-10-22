-- Incident-scoped delivery timeline spans notifications; build online.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notification_attempt_global_cursor"
  ON "NotificationDeliveryAttempt" ("startedAt" DESC, "id" DESC);
