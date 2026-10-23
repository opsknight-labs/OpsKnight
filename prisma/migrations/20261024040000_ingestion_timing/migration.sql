-- Preserve activation-based operational/SLA clocks while exposing queue time.
-- Null means this timestamp was not recorded by an older image.
ALTER TABLE "IngestionReceipt" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "IngestionReceipt" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
CREATE INDEX "IngestionBatch_retained_payload_idx" ON "IngestionBatch" ("createdAt")
  WHERE "payload" <> 'null'::jsonb;
