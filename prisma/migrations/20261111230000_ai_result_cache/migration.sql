-- Additive only: nullable/defaulted columns and one new table. No existing row is rewritten or backfilled.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "AiSettings" ADD COLUMN "resultCacheEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AiUsageBreakdownDay" ADD COLUMN "cacheReadTokens" INTEGER;
ALTER TABLE "AiUsageBreakdownDay" ADD COLUMN "cacheWriteTokens" INTEGER;
ALTER TABLE "AiUsageBreakdownDay" ADD COLUMN "resultCacheHits" INTEGER;
ALTER TABLE "AiUsageBreakdownDay" ADD COLUMN "savedTokens" INTEGER;
ALTER TABLE "AiUsageBreakdownDay" ADD COLUMN "savedCostMicros" BIGINT;

CREATE TABLE "AiResultCache" (
  "id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "promptId" TEXT NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "outputEncrypted" TEXT NOT NULL,
  "providerKind" TEXT NOT NULL,
  "servedModel" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "costMicros" BIGINT,
  "hits" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiResultCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiResultCache_lookup_key"
  ON "AiResultCache"("capability", "promptId", "promptVersion", "model", "scopeKey", "inputHash");
CREATE INDEX "AiResultCache_expiresAt_idx" ON "AiResultCache"("expiresAt");
