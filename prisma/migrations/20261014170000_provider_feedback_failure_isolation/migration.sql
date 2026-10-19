ALTER TABLE "NotificationProviderFeedback"
 ADD COLUMN "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "quarantinedAt" TIMESTAMP(3),
 ADD COLUMN "reconciliationReason" TEXT;
CREATE INDEX "idx_feedback_replay_due" ON "NotificationProviderFeedback" ("processedAt", "quarantinedAt", "nextReconcileAt");
CREATE INDEX "idx_feedback_processed_retention" ON "NotificationProviderFeedback" ("processedAt", id);
CREATE INDEX "idx_feedback_quarantine_retention" ON "NotificationProviderFeedback" ("quarantinedAt", id);
