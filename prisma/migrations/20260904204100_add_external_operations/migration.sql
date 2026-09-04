CREATE TYPE "ExternalOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'AMBIGUOUS', 'COMPLETED', 'FAILED');

CREATE TABLE "ExternalOperation" (
  "id" TEXT NOT NULL,
  "provider" "ExternalIssueProvider" NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "incidentId" TEXT,
  "actionItemId" TEXT,
  "status" "ExternalOperationStatus" NOT NULL DEFAULT 'PENDING',
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "externalId" TEXT,
  "externalKey" TEXT,
  "requestPayload" JSONB,
  "resultPayload" JSONB,
  "lastError" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalOperation_provider_idempotencyKey_key"
  ON "ExternalOperation"("provider", "idempotencyKey");
CREATE INDEX "ExternalOperation_status_nextAttemptAt_leaseExpiresAt_idx"
  ON "ExternalOperation"("status", "nextAttemptAt", "leaseExpiresAt");
CREATE INDEX "ExternalOperation_incidentId_operation_idx"
  ON "ExternalOperation"("incidentId", "operation");
CREATE INDEX "ExternalOperation_actionItemId_operation_idx"
  ON "ExternalOperation"("actionItemId", "operation");
