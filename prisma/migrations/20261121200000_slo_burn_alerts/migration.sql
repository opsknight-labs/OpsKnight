-- Additive only: three new, empty tables for SLO burn-rate alerting. Nothing existing is altered.
-- The plain CREATE INDEX statements below are an exception to the one-CREATE-INDEX-CONCURRENTLY-per-file
-- rule, acceptable ONLY because every one of them is on a table this same migration creates (empty, not
-- yet visible to any writer). An index on an existing table must go in its own CONCURRENTLY migration.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

CREATE TABLE "SloAlertPolicy" (
  "id" TEXT NOT NULL,
  "lineageId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "connectionId" TEXT,
  "goodQuery" TEXT NOT NULL,
  "totalQuery" TEXT NOT NULL,
  "stepSeconds" INTEGER NOT NULL DEFAULT 300,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "ticketsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "state" TEXT NOT NULL DEFAULT 'OK',
  "stateSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "belowStreak" INTEGER NOT NULL DEFAULT 0,
  "lastEvaluatedAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastError" TEXT,
  "lastIncidentId" TEXT,
  "coverageFrom" TIMESTAMP(3),
  "lastGeneration" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SloAlertPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SloAlertPolicy_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SloAlertPolicy_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ObservabilityConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SloAlertPolicy_lineageId_key" ON "SloAlertPolicy"("lineageId");
CREATE INDEX "SloAlertPolicy_enabled_lastEvaluatedAt_idx" ON "SloAlertPolicy"("enabled", "lastEvaluatedAt");
CREATE INDEX "SloAlertPolicy_serviceId_idx" ON "SloAlertPolicy"("serviceId");
CREATE INDEX "SloAlertPolicy_connectionId_idx" ON "SloAlertPolicy"("connectionId");

CREATE TABLE "SloSliPoint" (
  "policyId" TEXT NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "good" DOUBLE PRECISION NOT NULL,
  "total" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "SloSliPoint_pkey" PRIMARY KEY ("policyId", "bucketStart"),
  CONSTRAINT "SloSliPoint_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SloAlertPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SloAlertTransition" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "burnByWindow" JSONB NOT NULL,
  "incidentId" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SloAlertTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SloAlertTransition_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SloAlertPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SloAlertTransition_policyId_at_idx" ON "SloAlertTransition"("policyId", "at");

RESET statement_timeout;
RESET lock_timeout;
