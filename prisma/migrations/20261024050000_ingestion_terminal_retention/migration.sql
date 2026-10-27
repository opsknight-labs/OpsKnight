-- Additive indexes only: old clients and producers keep their existing schema.
CREATE INDEX "IngestionReceipt_expired_terminal_idx" ON "IngestionReceipt" ("completedAt")
  WHERE "status" IN ('COMPLETED', 'ARCHIVED') AND "envelope" = 'null'::jsonb;
CREATE INDEX "IngestionBatch_minimized_idx" ON "IngestionBatch" ("createdAt")
  WHERE "payload" = 'null'::jsonb;
