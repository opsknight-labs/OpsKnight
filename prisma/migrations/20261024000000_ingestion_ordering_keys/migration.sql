ALTER TABLE "IngestionReceipt" ADD COLUMN "orderingKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "IngestionReceipt_unfinished_ordering_keys_idx" ON "IngestionReceipt" USING GIN ("orderingKeys") WHERE "status" <> 'COMPLETED';
