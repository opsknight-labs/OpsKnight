ALTER TABLE "SystemSettings" ADD COLUMN "automationEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "automationTraceRetentionDays" INTEGER NOT NULL DEFAULT 90, ADD COLUMN "automationSettingsRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SystemSettings" ADD CONSTRAINT "automation_retention_range" CHECK ("automationTraceRetentionDays" BETWEEN 1 AND 3650);
