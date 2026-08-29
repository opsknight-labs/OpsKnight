-- Partial unique index to prevent duplicate incidents with same dedupKey/serviceId when active
-- This protects against race conditions in the deduplication logic at the database level
CREATE UNIQUE INDEX "Incident_dedupKey_serviceId_active_key"
ON "Incident" ("dedupKey", "serviceId")
WHERE "status" IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED');
