-- AlterTable
ALTER TABLE "StatusPageAnnouncement" ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StatusPageAnnouncement" ADD COLUMN "timeMode" TEXT NOT NULL DEFAULT 'EXACT';

-- AlterTable
ALTER TABLE "StatusPageSubscription" ADD COLUMN "timezone" TEXT DEFAULT 'UTC';
