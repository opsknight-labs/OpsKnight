-- Additive only: nullable columns and three small new tables. No existing row is rewritten or backfilled.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "AiUsageDay" ADD COLUMN "costMicros" BIGINT;
ALTER TABLE "AiUsageUserDay" ADD COLUMN "costMicros" BIGINT;
ALTER TABLE "AiTokenReservation" ADD COLUMN "teamId" TEXT;
ALTER TABLE "AiTokenReservation" ADD COLUMN "capability" TEXT;
ALTER TABLE "AiTokenReservation" ADD COLUMN "costMicros" BIGINT;

CREATE TABLE "AiModelPrice" (
  "id" TEXT NOT NULL,
  "providerKind" "AiProviderKind" NOT NULL,
  "model" TEXT NOT NULL,
  "inputUsdPerMTok" DOUBLE PRECISION NOT NULL,
  "outputUsdPerMTok" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiModelPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiModelPrice_providerKind_model_key" ON "AiModelPrice"("providerKind", "model");

CREATE TABLE "AiBudget" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "teamId" TEXT,
  "capability" TEXT,
  "dailyTokenLimit" INTEGER,
  "dailyCostLimitMicros" BIGINT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiBudget_key_key" ON "AiBudget"("key");

CREATE TABLE "AiUsageBreakdownDay" (
  "day" TEXT NOT NULL,
  "teamId" TEXT NOT NULL DEFAULT '',
  "capability" TEXT NOT NULL,
  "providerKind" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "costMicros" BIGINT NOT NULL DEFAULT 0,
  "unpricedRequests" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiUsageBreakdownDay_pkey" PRIMARY KEY ("day", "teamId", "capability", "providerKind", "model")
);

RESET statement_timeout;
RESET lock_timeout;
