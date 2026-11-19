-- Validates the foreign keys added NOT VALID in 20261117000100. VALIDATE takes only
-- SHARE UPDATE EXCLUSIVE on the referencing table, so writes continue during the scan.
ALTER TABLE "Incident" VALIDATE CONSTRAINT "Incident_maintenanceWindowId_fkey";
ALTER TABLE "StatusPageAnnouncement" VALIDATE CONSTRAINT "StatusPageAnnouncement_maintenanceWindowId_fkey";
