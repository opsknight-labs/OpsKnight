CREATE INDEX "IngestionReceipt_completed_metrics_idx" ON "IngestionReceipt" ("completedAt")
  WHERE "status" = 'COMPLETED';
