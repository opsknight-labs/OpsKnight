-- Service-level maintenance windows: while a window is active, new alerts for its
-- services create SUPPRESSED incidents (nobody paged). The join table carries
-- denormalised bounds so the ingestion hot path is a single index range scan.
-- Additive only: new enum, two tables, two nullable link columns.

CREATE TYPE "MaintenanceEndBehavior" AS ENUM ('RESUME_FIRING', 'RESOLVE_HELD');

CREATE TABLE "MaintenanceWindow" (
    "revision" INTEGER NOT NULL DEFAULT 1,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endBehavior" "MaintenanceEndBehavior" NOT NULL DEFAULT 'RESUME_FIRING',
    "publishToStatusPage" BOOLEAN NOT NULL DEFAULT false,
    "endProcessedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "MaintenanceWindowService" (
    "windowId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceWindowService_pkey" PRIMARY KEY ("windowId","serviceId")
);

ALTER TABLE "Incident" ADD COLUMN "maintenanceWindowId" TEXT;
ALTER TABLE "StatusPageAnnouncement" ADD COLUMN "maintenanceWindowId" TEXT;

CREATE INDEX "MaintenanceWindow_endProcessedAt_endsAt_idx" ON "MaintenanceWindow"("endProcessedAt", "endsAt");
CREATE INDEX "MaintenanceWindow_startsAt_idx" ON "MaintenanceWindow"("startsAt");
CREATE INDEX "MaintenanceWindowService_serviceId_endsAt_startsAt_idx" ON "MaintenanceWindowService"("serviceId", "endsAt", "startsAt");
CREATE INDEX "Incident_maintenanceWindowId_status_idx" ON "Incident"("maintenanceWindowId", "status");
CREATE INDEX "StatusPageAnnouncement_maintenanceWindowId_idx" ON "StatusPageAnnouncement"("maintenanceWindowId");
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_maintenanceWindowId_fkey" FOREIGN KEY ("maintenanceWindowId") REFERENCES "MaintenanceWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StatusPageAnnouncement" ADD CONSTRAINT "StatusPageAnnouncement_maintenanceWindowId_fkey" FOREIGN KEY ("maintenanceWindowId") REFERENCES "MaintenanceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindowService" ADD CONSTRAINT "MaintenanceWindowService_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "MaintenanceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindowService" ADD CONSTRAINT "MaintenanceWindowService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "MaintenanceWindow_bump_revision" BEFORE UPDATE ON "MaintenanceWindow"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();

ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_bounds_check" CHECK ("endsAt" >= "startsAt");
ALTER TABLE "MaintenanceWindowService" ADD CONSTRAINT "MaintenanceWindowService_bounds_check" CHECK ("endsAt" >= "startsAt");
