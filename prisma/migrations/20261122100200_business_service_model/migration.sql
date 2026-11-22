-- Business services P1a: criticality, nesting, impact history, internal dashboards, team
-- subscriptions, maintenance scoping and status-page group overrides. Expand-only: new tables
-- build their indexes inline; existing tables only gain nullable or defaulted columns.

-- CreateEnum
CREATE TYPE "BusinessServiceTier" AS ENUM ('TIER_0', 'TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "BusinessServiceImpactSource" AS ENUM ('DIRECT', 'DEPENDENCY', 'NESTED', 'MANUAL');

-- AlterTable
ALTER TABLE "BusinessService" ADD COLUMN     "criticality" "BusinessServiceTier",
ADD COLUMN     "impactMaxPriority" TEXT,
ADD COLUMN     "impactMinUrgency" "IncidentUrgency",
ADD COLUMN     "links" JSONB,
ADD COLUMN     "statusPageSummary" TEXT;

-- AlterTable
ALTER TABLE "BusinessServiceMember" ADD COLUMN     "critical" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StatusPageBusinessService" ADD COLUMN     "showMembers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "statusOverride" TEXT,
ADD COLUMN     "statusOverrideUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BusinessServiceSupport" (
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessServiceSupport_pkey" PRIMARY KEY ("parentId","childId")
);

-- CreateTable
CREATE TABLE "IncidentBusinessServiceImpact" (
    "incidentId" TEXT NOT NULL,
    "businessServiceId" TEXT NOT NULL,
    "source" "BusinessServiceImpactSource" NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentBusinessServiceImpact_pkey" PRIMARY KEY ("incidentId","businessServiceId")
);

-- CreateTable
CREATE TABLE "StatusDashboard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusDashboardBusinessService" (
    "dashboardId" TEXT NOT NULL,
    "businessServiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StatusDashboardBusinessService_pkey" PRIMARY KEY ("dashboardId","businessServiceId")
);

-- CreateTable
CREATE TABLE "BusinessServiceTeamSubscriber" (
    "businessServiceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessServiceTeamSubscriber_pkey" PRIMARY KEY ("businessServiceId","teamId")
);

-- CreateTable
CREATE TABLE "MaintenanceWindowBusinessService" (
    "maintenanceWindowId" TEXT NOT NULL,
    "businessServiceId" TEXT NOT NULL,

    CONSTRAINT "MaintenanceWindowBusinessService_pkey" PRIMARY KEY ("maintenanceWindowId","businessServiceId")
);

-- CreateIndex
CREATE INDEX "BusinessServiceSupport_childId_idx" ON "BusinessServiceSupport"("childId");

-- CreateIndex
CREATE INDEX "IncidentBusinessServiceImpact_businessServiceId_startedAt_idx" ON "IncidentBusinessServiceImpact"("businessServiceId", "startedAt");

-- CreateIndex
CREATE INDEX "IncidentBusinessServiceImpact_endedAt_idx" ON "IncidentBusinessServiceImpact"("endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusDashboard_slug_key" ON "StatusDashboard"("slug");

-- CreateIndex
CREATE INDEX "StatusDashboard_ownerTeamId_idx" ON "StatusDashboard"("ownerTeamId");

-- CreateIndex
CREATE INDEX "StatusDashboardBusinessService_businessServiceId_idx" ON "StatusDashboardBusinessService"("businessServiceId");

-- CreateIndex
CREATE INDEX "BusinessServiceTeamSubscriber_teamId_idx" ON "BusinessServiceTeamSubscriber"("teamId");

-- CreateIndex
CREATE INDEX "MaintenanceWindowBusinessService_businessServiceId_idx" ON "MaintenanceWindowBusinessService"("businessServiceId");

-- AddForeignKey
ALTER TABLE "BusinessServiceSupport" ADD CONSTRAINT "BusinessServiceSupport_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceSupport" ADD CONSTRAINT "BusinessServiceSupport_childId_fkey" FOREIGN KEY ("childId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentBusinessServiceImpact" ADD CONSTRAINT "IncidentBusinessServiceImpact_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentBusinessServiceImpact" ADD CONSTRAINT "IncidentBusinessServiceImpact_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentBusinessServiceImpact" ADD CONSTRAINT "IncidentBusinessServiceImpact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusDashboard" ADD CONSTRAINT "StatusDashboard_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusDashboardBusinessService" ADD CONSTRAINT "StatusDashboardBusinessService_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "StatusDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusDashboardBusinessService" ADD CONSTRAINT "StatusDashboardBusinessService_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceTeamSubscriber" ADD CONSTRAINT "BusinessServiceTeamSubscriber_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceTeamSubscriber" ADD CONSTRAINT "BusinessServiceTeamSubscriber_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindowBusinessService" ADD CONSTRAINT "MaintenanceWindowBusinessService_maintenanceWindowId_fkey" FOREIGN KEY ("maintenanceWindowId") REFERENCES "MaintenanceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindowBusinessService" ADD CONSTRAINT "MaintenanceWindowBusinessService_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A business service cannot support itself; longer cycles are rejected by the command layer.
ALTER TABLE "BusinessServiceSupport" ADD CONSTRAINT "BusinessServiceSupport_not_self" CHECK ("parentId" <> "childId");

-- Best-effort: carry the legacy free-text tier ("Tier 1", "T2", "0") into criticality.
UPDATE "BusinessService"
SET "criticality" = ('TIER_' || substring("tier" from '(?i)^\s*(?:tier|t)?[\s_-]*([0-3])\s*$'))::"BusinessServiceTier"
WHERE "criticality" IS NULL AND "tier" ~* '^\s*(tier|t)?[\s_-]*[0-3]\s*$';
