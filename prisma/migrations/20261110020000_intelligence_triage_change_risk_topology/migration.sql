-- Additive only: enum values, nullable columns, a constant-default boolean and one small new table.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_URGENCY';
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_ASSIGNMENT';
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_DUPLICATE';
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_RESOLUTION_TIME';

ALTER TABLE "ChangeEvent"
  ADD COLUMN "riskScore" DOUBLE PRECISION,
  ADD COLUMN "riskEvidence" JSONB,
  ADD COLUMN "riskComputedAt" TIMESTAMP(3);

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "handoffSummaryEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TopologySource" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'BACKSTAGE_CATALOG',
  "url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
  "lastSyncedAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastSummary" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopologySource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TopologySource_name_key" ON "TopologySource"("name");
CREATE INDEX "TopologySource_enabled_lastSyncedAt_idx" ON "TopologySource"("enabled", "lastSyncedAt");

RESET statement_timeout;
RESET lock_timeout;
