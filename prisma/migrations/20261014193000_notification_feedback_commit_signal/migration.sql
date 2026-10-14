CREATE INDEX "idx_feedback_quarantined_message" ON "NotificationProviderFeedback" ("providerMessageId", provider, "reconciliationReason", "quarantinedAt");
ALTER TABLE "Notification" ADD COLUMN "feedbackPending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "idx_notification_feedback_pending" ON "Notification" (id) WHERE "feedbackPending" = true;
-- Historical unmatched quarantines with newly available evidence also need replay.
UPDATE "Notification" n SET "feedbackPending" = true WHERE n."providerMessageId" IS NOT NULL AND EXISTS (
 SELECT 1 FROM "NotificationProviderFeedback" f WHERE f."providerMessageId" = n."providerMessageId"
 AND f."processedAt" IS NULL AND f."quarantinedAt" IS NOT NULL AND f."reconciliationReason" = 'UNMATCHED_PROVIDER_MESSAGE'
);
