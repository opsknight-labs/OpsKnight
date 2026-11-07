CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_fingerprint_incident_cursor"
ON "AlertFingerprint" ("incidentId", "alertCreatedAt", "alertId");
