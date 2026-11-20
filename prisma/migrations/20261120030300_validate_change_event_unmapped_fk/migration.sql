-- Validates the foreign key added NOT VALID in 20261120030100. VALIDATE takes only SHARE UPDATE EXCLUSIVE on
-- "ChangeEvent", so change writes continue during the scan.
ALTER TABLE "ChangeEvent" VALIDATE CONSTRAINT "ChangeEvent_unmappedIntegrationId_fkey";
