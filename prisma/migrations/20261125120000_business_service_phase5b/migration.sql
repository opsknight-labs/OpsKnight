-- AlterTable
ALTER TABLE "BusinessService"
  ADD COLUMN "customersTotal" INTEGER,
  ADD COLUMN "revenuePerHourCents" INTEGER,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "customerReportThreshold" INTEGER,
  ADD COLUMN "customerReportWindowMinutes" INTEGER,
  ADD COLUMN "reviewIntervalDays" INTEGER;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "businessServiceHygieneEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CustomerImpactReport" (
    "id" TEXT NOT NULL,
    "businessServiceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "externalRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerImpactReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessServiceTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criticality" "BusinessServiceTier",
    "sloTarget" DOUBLE PRECISION,
    "sloWindowDays" INTEGER NOT NULL DEFAULT 30,
    "quorumPartialPct" INTEGER,
    "quorumMajorPct" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" TEXT,
    "lifecycle" "BusinessServiceLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "links" JSONB,
    "impactMinUrgency" "IncidentUrgency",
    "impactMaxPriority" TEXT,
    "ownerTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessServiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImpactReport_businessServiceId_externalRef_key" ON "CustomerImpactReport"("businessServiceId", "externalRef");

-- CreateIndex
CREATE INDEX "CustomerImpactReport_businessServiceId_windowEnd_idx" ON "CustomerImpactReport"("businessServiceId", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessServiceTemplate_name_key" ON "BusinessServiceTemplate"("name");

-- AddForeignKey
ALTER TABLE "CustomerImpactReport" ADD CONSTRAINT "CustomerImpactReport_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImpactReport" ADD CONSTRAINT "CustomerImpactReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceTemplate" ADD CONSTRAINT "BusinessServiceTemplate_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
