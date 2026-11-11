-- Operations insights (Workstream J foundation). Additive only: three enums, two new, empty tables (their
-- indexes are created here, on empty tables), one nullable column and seven defaulted switches. No existing
-- row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

CREATE TYPE "OpsInsightScopeType" AS ENUM ('SERVICE', 'POLICY', 'SCHEDULE', 'RUNBOOK', 'USER', 'TEAM');
CREATE TYPE "OpsInsightSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "OpsInsightStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'RESOLVED');

CREATE TABLE "OpsInsight" (
  "id" TEXT NOT NULL,
  "scopeType" "OpsInsightScopeType" NOT NULL,
  "scopeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL DEFAULT '',
  "area" TEXT NOT NULL,
  "severity" "OpsInsightSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "draftHref" TEXT,
  "inputHash" TEXT NOT NULL,
  "status" "OpsInsightStatus" NOT NULL DEFAULT 'OPEN',
  "generation" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsInsight_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpsInsight_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_ops_insight_scope_kind_key" ON "OpsInsight"("scopeType", "scopeId", "kind", "key");
CREATE INDEX "idx_ops_insight_inbox" ON "OpsInsight"("status", "severity" DESC, "lastSeenAt" DESC, "id" DESC);
CREATE INDEX "idx_ops_insight_retention" ON "OpsInsight"("status", "updatedAt");
CREATE INDEX "idx_ops_insight_decided_by" ON "OpsInsight"("decidedById");

CREATE TABLE "OpsInsightScopeState" (
  "scopeType" "OpsInsightScopeType" NOT NULL,
  "scopeId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsInsightScopeState_pkey" PRIMARY KEY ("scopeType", "scopeId")
);
CREATE INDEX "idx_ops_insight_scope_due" ON "OpsInsightScopeState"("scopeType", "computedAt");

ALTER TABLE "MetricRollup" ADD COLUMN "subjectKey" TEXT;

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "opsInsightsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opsInsightsAutomationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opsInsightsEscalationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opsInsightsOnCallEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opsInsightsPostmortemsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opsInsightsRunbooksEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opsInsightsNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;
