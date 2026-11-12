CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_incident_modified"
ON "Alert" ("incidentId", "updatedAt", id) WHERE "updatedAt" IS NOT NULL;
