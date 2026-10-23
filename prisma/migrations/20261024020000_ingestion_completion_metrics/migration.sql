CREATE INDEX "IngestionReceipt_acceptedAt_idx" ON "IngestionReceipt" ("acceptedAt");
CREATE INDEX "IngestionReceipt_completedAt_idx" ON "IngestionReceipt" ("completedAt") WHERE "status" = 'COMPLETED';
