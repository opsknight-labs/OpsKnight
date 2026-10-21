-- Incident-scoped alert correlation is cursor paginated. Build online.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_incident_cursor"
  ON "Alert" ("incidentId", "createdAt" DESC, "id" DESC);
