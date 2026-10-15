ALTER TABLE "SystemSettings" ADD COLUMN "runbookArtifactRetentionDays" INTEGER;
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_runbookArtifactRetentionDays_check" CHECK ("runbookArtifactRetentionDays" BETWEEN 1 AND 3650);
