ALTER TABLE "IngestionReceipt" ADD COLUMN "critical" BOOLEAN NOT NULL DEFAULT false;
UPDATE "IngestionReceipt" SET "critical" = true
  WHERE "status" IN ('PENDING', 'PROCESSING', 'DEAD')
    AND "envelope"->'event'->'payload'->>'severity' = 'critical';
CREATE INDEX "IngestionReceipt_critical_head_idx" ON "IngestionReceipt" ("critical", "sequence")
  WHERE "status" IN ('PENDING', 'PROCESSING');
