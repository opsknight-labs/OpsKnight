-- Add data retention policy fields to SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "incidentRetentionDays" INTEGER DEFAULT 730;
ALTER TABLE "SystemSettings" ADD COLUMN "alertRetentionDays" INTEGER DEFAULT 365;
ALTER TABLE "SystemSettings" ADD COLUMN "logRetentionDays" INTEGER DEFAULT 90;
ALTER TABLE "SystemSettings" ADD COLUMN "metricsRetentionDays" INTEGER DEFAULT 365;
ALTER TABLE "SystemSettings" ADD COLUMN "realTimeWindowDays" INTEGER DEFAULT 90;

-- Create IncidentMetricRollup for pre-aggregated historical data
CREATE TABLE "IncidentMetricRollup" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL DEFAULT 'daily',
    "serviceId" TEXT,
    "teamId" TEXT,
    
    -- Counts
    "totalIncidents" INTEGER NOT NULL DEFAULT 0,
    "openIncidents" INTEGER NOT NULL DEFAULT 0,
    "acknowledgedIncidents" INTEGER NOT NULL DEFAULT 0,
    "resolvedIncidents" INTEGER NOT NULL DEFAULT 0,
    "highUrgencyIncidents" INTEGER NOT NULL DEFAULT 0,
    "mediumUrgencyIncidents" INTEGER NOT NULL DEFAULT 0,
    "lowUrgencyIncidents" INTEGER NOT NULL DEFAULT 0,
    
    -- SLA Metrics (in milliseconds for precision)
    "mttaSum" BIGINT NOT NULL DEFAULT 0,
    "mttaCount" INTEGER NOT NULL DEFAULT 0,
    "mttrSum" BIGINT NOT NULL DEFAULT 0,
    "mttrCount" INTEGER NOT NULL DEFAULT 0,
    
    -- SLA Compliance
    "ackSlaMet" INTEGER NOT NULL DEFAULT 0,
    "ackSlaBreached" INTEGER NOT NULL DEFAULT 0,
    "resolveSlaMet" INTEGER NOT NULL DEFAULT 0,
    "resolveSlaBreached" INTEGER NOT NULL DEFAULT 0,
    
    -- Event Counts
    "escalationCount" INTEGER NOT NULL DEFAULT 0,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "autoResolveCount" INTEGER NOT NULL DEFAULT 0,
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    
    -- After Hours
    "afterHoursCount" INTEGER NOT NULL DEFAULT 0,
    
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentMetricRollup_pkey" PRIMARY KEY ("id")
);

-- Indexes for efficient querying
CREATE INDEX "IncidentMetricRollup_date_idx" ON "IncidentMetricRollup"("date");
CREATE INDEX "IncidentMetricRollup_granularity_date_idx" ON "IncidentMetricRollup"("granularity", "date");
CREATE INDEX "IncidentMetricRollup_serviceId_date_idx" ON "IncidentMetricRollup"("serviceId", "date");
CREATE INDEX "IncidentMetricRollup_teamId_date_idx" ON "IncidentMetricRollup"("teamId", "date");

-- Unique constraint to prevent duplicate rollups
CREATE UNIQUE INDEX "IncidentMetricRollup_date_granularity_serviceId_teamId_key" 
ON "IncidentMetricRollup"("date", "granularity", "serviceId", "teamId");
