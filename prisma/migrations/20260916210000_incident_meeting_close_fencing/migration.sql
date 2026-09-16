-- AlterTable
ALTER TABLE "IncidentMeeting" ADD COLUMN "closeToken" TEXT;
ALTER TABLE "IncidentMeeting" ADD COLUMN "cleanupRetryCount" INTEGER NOT NULL DEFAULT 0;
