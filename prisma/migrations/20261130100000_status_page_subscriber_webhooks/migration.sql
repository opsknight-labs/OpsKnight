-- Self-service subscriber webhooks reuse the durable status-page webhook pipeline.
ALTER TABLE "StatusPageWebhook"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE INDEX "StatusPageWebhook_statusPageId_source_idx" ON "StatusPageWebhook"("statusPageId", "source");
