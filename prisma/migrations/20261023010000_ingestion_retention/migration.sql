CREATE INDEX "IngestionReceipt_completed_payload_retention_idx"
ON "IngestionReceipt" ("completedAt")
WHERE "status" = 'COMPLETED' AND "envelope" <> 'null'::jsonb;
