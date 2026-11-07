-- Incident state is checked in the indexed join; cross-table partial predicates are invalid.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_service_fingerprint_recent"
ON "Alert" ("serviceId", "fingerprintHash", "createdAt" DESC, id DESC)
WHERE "fingerprintHash" IS NOT NULL AND "incidentId" IS NOT NULL;
