ALTER TABLE "Notification" ADD COLUMN "deliveryProvider" TEXT;
ALTER TABLE "NotificationProviderFeedback" ADD COLUMN "processedAt" TIMESTAMP(3), ADD COLUMN "nextReconcileAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Preserve existing provider evidence; never infer it from the callback itself.
UPDATE "Notification" n SET "deliveryProvider" = (
  SELECT a.provider FROM "NotificationDeliveryAttempt" a
  WHERE a."notificationId" = n.id AND a."providerMessageId" = n."providerMessageId" AND a.provider IS NOT NULL
  ORDER BY a.ordinal DESC LIMIT 1
) WHERE n."providerMessageId" IS NOT NULL;
-- Previously ingested events may already have applied non-idempotent endpoint counters.
UPDATE "NotificationProviderFeedback" f SET "processedAt" = f."createdAt" WHERE f."providerMessageId" IS NULL OR EXISTS (SELECT 1 FROM "Notification" n WHERE n."providerMessageId" = f."providerMessageId");
CREATE INDEX "idx_feedback_provider_message_pending" ON "NotificationProviderFeedback" (provider, "providerMessageId", "processedAt");
CREATE INDEX "NotificationProviderFeedback_processedAt_nextReconcileAt_idx" ON "NotificationProviderFeedback" ("processedAt", "nextReconcileAt");
