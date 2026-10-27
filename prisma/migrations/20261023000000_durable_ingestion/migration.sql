CREATE TABLE "IngestionReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sequence" BIGSERIAL NOT NULL UNIQUE,
  "serviceId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "partitionKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "contentHash" TEXT NOT NULL,
  "budgetShard" INTEGER NOT NULL,
  "payloadBytes" INTEGER NOT NULL,
  "envelope" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "result" JSONB,
  "failureCode" TEXT,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "IngestionReceipt_status_check" CHECK ("status" IN ('PENDING','PROCESSING','COMPLETED','DEAD')),
  CONSTRAINT "IngestionReceipt_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "IngestionReceipt_lease_check" CHECK (
    ("status" = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR
    ("status" <> 'PROCESSING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
  )
);
CREATE INDEX "IngestionReceipt_partitionKey_sequence_idx" ON "IngestionReceipt" ("partitionKey", "sequence");
CREATE INDEX "IngestionReceipt_status_availableAt_sequence_idx" ON "IngestionReceipt" ("status", "availableAt", "sequence");
CREATE INDEX "IngestionReceipt_serviceId_acceptedAt_idx" ON "IngestionReceipt" ("serviceId", "acceptedAt");
-- Keep predecessor scans proportional to unfinished work, rather than retained history.
CREATE INDEX "IngestionReceipt_unfinished_partition_idx" ON "IngestionReceipt" ("partitionKey", "sequence") WHERE "status" <> 'COMPLETED';
CREATE TABLE "IngestionBudget" (
  "shard" INTEGER PRIMARY KEY CHECK ("shard" >= 0 AND "shard" < 64),
  "pending" INTEGER NOT NULL DEFAULT 0 CHECK ("pending" >= 0),
  "bytes" BIGINT NOT NULL DEFAULT 0 CHECK ("bytes" >= 0)
);
INSERT INTO "IngestionBudget" ("shard") SELECT generate_series(0, 63);
