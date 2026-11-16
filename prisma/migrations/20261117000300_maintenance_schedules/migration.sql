-- Recurring maintenance schedules. The scheduler materialises each upcoming
-- occurrence as an ordinary MaintenanceWindow (linked by scheduleId), so the
-- ingestion hot path and the end sweep are unchanged.
-- Additive only: new enum, two tables, one nullable link column.

CREATE TYPE "MaintenanceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "MaintenanceSchedule" (
    "revision" INTEGER NOT NULL DEFAULT 1,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "endBehavior" "MaintenanceEndBehavior" NOT NULL DEFAULT 'RESUME_FIRING',
    "publishToStatusPage" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "MaintenanceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "byWeekday" INTEGER[],
    "dayOfMonth" INTEGER,
    "timeZone" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT,
    "pausedAt" TIMESTAMP(3),
    "materializedUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceScheduleService" (
    "scheduleId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "MaintenanceScheduleService_pkey" PRIMARY KEY ("scheduleId","serviceId")
);

ALTER TABLE "MaintenanceWindow" ADD COLUMN "scheduleId" TEXT;

CREATE INDEX "MaintenanceSchedule_pausedAt_materializedUntil_idx" ON "MaintenanceSchedule"("pausedAt", "materializedUntil");
CREATE INDEX "MaintenanceScheduleService_serviceId_idx" ON "MaintenanceScheduleService"("serviceId");
CREATE UNIQUE INDEX "MaintenanceWindow_scheduleId_startsAt_key" ON "MaintenanceWindow"("scheduleId", "startsAt");
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MaintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceScheduleService" ADD CONSTRAINT "MaintenanceScheduleService_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MaintenanceSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceScheduleService" ADD CONSTRAINT "MaintenanceScheduleService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "MaintenanceSchedule_bump_revision" BEFORE UPDATE ON "MaintenanceSchedule"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();

ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_interval_check" CHECK ("interval" >= 1);
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_duration_check" CHECK ("durationMinutes" >= 1 AND "durationMinutes" <= 10080);
