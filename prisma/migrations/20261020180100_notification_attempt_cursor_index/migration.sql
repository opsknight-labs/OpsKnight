-- Bounded notification-attempt timeline. Build online.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notification_attempt_cursor"
  ON "NotificationDeliveryAttempt" ("notificationId", "startedAt" DESC, "id" DESC);
