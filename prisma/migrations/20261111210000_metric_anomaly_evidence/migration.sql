-- Additive only: one enum value and two new, empty tables for lane-side metric anomaly evidence. Nothing
-- existing is altered beyond the enum value.
-- The plain CREATE INDEX statements below are an exception to the one-CREATE-INDEX-CONCURRENTLY-per-file
-- rule, acceptable ONLY because every one of them is on a table this same migration creates (empty, not
-- yet visible to any writer). An index on an existing table must go in its own CONCURRENTLY migration.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'METRIC_ANOMALY';

CREATE TABLE "ServiceMetricTemplate" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "connectionId" TEXT,
  "name" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "direction" TEXT NOT NULL DEFAULT 'BOTH',
  "thresholdMad" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "baselineWeeks" INTEGER NOT NULL DEFAULT 4,
  "windowMinutes" INTEGER NOT NULL DEFAULT 60,
  "stepSeconds" INTEGER NOT NULL DEFAULT 60,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
  "minDeviation" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastEvaluatedAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastGeneration" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceMetricTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceMetricTemplate_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ServiceMetricTemplate_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ObservabilityConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServiceMetricTemplate_serviceId_name_key" ON "ServiceMetricTemplate"("serviceId", "name");
CREATE INDEX "ServiceMetricTemplate_enabled_lastEvaluatedAt_idx" ON "ServiceMetricTemplate"("enabled", "lastEvaluatedAt");
CREATE INDEX "ServiceMetricTemplate_connectionId_idx" ON "ServiceMetricTemplate"("connectionId");

CREATE TABLE "MetricAnomaly" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "seriesKey" TEXT NOT NULL,
  "labels" JSONB,
  "at" TIMESTAMP(3) NOT NULL,
  "peakAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "direction" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "baselineMedian" DOUBLE PRECISION NOT NULL,
  "baselineMad" DOUBLE PRECISION NOT NULL,
  "baselineSamples" INTEGER NOT NULL,
  "points" INTEGER NOT NULL,
  "generation" INTEGER NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetricAnomaly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetricAnomaly_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ServiceMetricTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetricAnomaly_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetricAnomaly_templateId_seriesKey_at_key" ON "MetricAnomaly"("templateId", "seriesKey", "at");
CREATE INDEX "MetricAnomaly_serviceId_at_idx" ON "MetricAnomaly"("serviceId", "at");
CREATE INDEX "MetricAnomaly_at_idx" ON "MetricAnomaly"("at");

RESET statement_timeout;
RESET lock_timeout;
