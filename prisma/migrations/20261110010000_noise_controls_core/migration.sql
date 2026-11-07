-- Pre-paging noise controls: new tables only. Nothing here touches Incident or Alert rows, so no
-- backfill and no long locks; the indexes are created inline because the tables are empty.
SET lock_timeout = '2s';
SET statement_timeout = '30s';

CREATE TYPE "NoiseControlMode" AS ENUM ('OFF', 'SHADOW', 'ON');
CREATE TYPE "NoiseControlEffect" AS ENUM ('SUPPRESS', 'DOWNGRADE');
CREATE TYPE "MaintenanceScope" AS ENUM ('SERVICE', 'TEAM', 'LABEL', 'ALL');
CREATE TYPE "HeartbeatState" AS ENUM ('PENDING', 'HEALTHY', 'LATE', 'MISSING', 'PAUSED');
CREATE TYPE "PrePagingControl" AS ENUM ('MAINTENANCE', 'SUPPRESSION', 'ORCHESTRATION', 'CONTENT_DEDUP', 'FLAPPING', 'STORM', 'HEARTBEAT');
CREATE TYPE "PrePagingAction" AS ENUM ('NONE', 'SUPPRESS', 'DOWNGRADE', 'APPEND', 'GROUP_CHILD', 'HOLD', 'DROP', 'TRANSFORM');

CREATE TABLE "NoiseControlPolicy" (
  "id" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "serviceId" TEXT,
  "mode" "NoiseControlMode" NOT NULL DEFAULT 'OFF',
  "definition" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NoiseControlPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NoiseControlPolicy_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NoiseControlPolicy_scopeKey_key" ON "NoiseControlPolicy"("scopeKey");
CREATE INDEX "NoiseControlPolicy_serviceId_idx" ON "NoiseControlPolicy"("serviceId");
CREATE INDEX "NoiseControlPolicy_mode_idx" ON "NoiseControlPolicy"("mode");

CREATE TABLE "MaintenanceWindow" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "scope" "MaintenanceScope" NOT NULL,
  "serviceId" TEXT,
  "teamId" TEXT,
  "labelKey" VARCHAR(64),
  "labelValue" VARCHAR(128),
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "recurrence" VARCHAR(512),
  "effect" "NoiseControlEffect" NOT NULL DEFAULT 'SUPPRESS',
  "downgradeUrgency" "IncidentUrgency",
  "statusPageAnnouncementId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "endedAt" TIMESTAMP(3),
  "endedById" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaintenanceWindow_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MaintenanceWindow_enabled_endsAt_idx" ON "MaintenanceWindow"("enabled", "endsAt");
CREATE INDEX "MaintenanceWindow_serviceId_idx" ON "MaintenanceWindow"("serviceId");
CREATE INDEX "MaintenanceWindow_teamId_idx" ON "MaintenanceWindow"("teamId");

CREATE TABLE "SuppressionRule" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "serviceId" TEXT,
  "matchers" JSONB NOT NULL,
  "effect" "NoiseControlEffect" NOT NULL DEFAULT 'SUPPRESS',
  "downgradeUrgency" "IncidentUrgency",
  "expiresAt" TIMESTAMP(3),
  "ownerId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "origin" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  "suggestion" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuppressionRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SuppressionRule_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SuppressionRule_enabled_expiresAt_idx" ON "SuppressionRule"("enabled", "expiresAt");
CREATE INDEX "SuppressionRule_serviceId_idx" ON "SuppressionRule"("serviceId");

CREATE TABLE "HeartbeatMonitor" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "serviceId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "tokenPrefix" VARCHAR(8) NOT NULL,
  "intervalSeconds" INTEGER NOT NULL,
  "graceSeconds" INTEGER NOT NULL DEFAULT 60,
  "urgency" "IncidentUrgency" NOT NULL DEFAULT 'MEDIUM',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "state" "HeartbeatState" NOT NULL DEFAULT 'PENDING',
  "lastPingAt" TIMESTAMP(3),
  "missingSince" TIMESTAMP(3),
  "lastIncidentId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HeartbeatMonitor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HeartbeatMonitor_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HeartbeatMonitor_tokenHash_key" ON "HeartbeatMonitor"("tokenHash");
CREATE INDEX "HeartbeatMonitor_enabled_state_idx" ON "HeartbeatMonitor"("enabled", "state");
CREATE INDEX "HeartbeatMonitor_serviceId_idx" ON "HeartbeatMonitor"("serviceId");

CREATE TABLE "PrePagingDecision" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "incidentId" TEXT,
  "alertId" TEXT,
  "control" "PrePagingControl" NOT NULL,
  "action" "PrePagingAction" NOT NULL,
  "mode" "NoiseControlMode" NOT NULL,
  "applied" BOOLEAN NOT NULL,
  "sourceId" TEXT,
  "sourceName" VARCHAR(120),
  "reason" VARCHAR(500) NOT NULL,
  "evidence" JSONB NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "reversedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrePagingDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrePagingDecision_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PrePagingDecision_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PrePagingDecision_serviceId_createdAt_idx" ON "PrePagingDecision"("serviceId", "createdAt");
CREATE INDEX "PrePagingDecision_incidentId_idx" ON "PrePagingDecision"("incidentId");
CREATE INDEX "PrePagingDecision_control_mode_createdAt_idx" ON "PrePagingDecision"("control", "mode", "createdAt");
CREATE INDEX "PrePagingDecision_createdAt_idx" ON "PrePagingDecision"("createdAt");

RESET statement_timeout;
RESET lock_timeout;
