-- Business-service notifications: status-page update auto-publish opt-in and error-budget alert state.
ALTER TABLE "BusinessService"
  ADD COLUMN "autoPublishStatusUpdates" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastBudgetState" TEXT,
  ADD COLUMN "lastBudgetStateAt" TIMESTAMP(3);

-- Status-page subscriber channels beyond email: per-page switches (existing pages keep email + webhook).
ALTER TABLE "StatusPage"
  ADD COLUMN "subscriberChannels" TEXT[] DEFAULT ARRAY['EMAIL', 'WEBHOOK']::TEXT[];

ALTER TABLE "StatusPageSubscription"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "targetEncrypted" TEXT;

CREATE INDEX "StatusPageSubscription_channel_idx"
  ON "StatusPageSubscription"("statusPageId", "channel", "state");
