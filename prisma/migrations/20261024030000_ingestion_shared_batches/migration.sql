CREATE TABLE "IngestionBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serviceId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "IngestionReceipt" ADD COLUMN "batchId" TEXT;
ALTER TABLE "IngestionReceipt" ADD CONSTRAINT "IngestionReceipt_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "IngestionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "IngestionReceipt_batchId_idx" ON "IngestionReceipt"("batchId");
