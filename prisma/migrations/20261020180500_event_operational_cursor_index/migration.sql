-- Bounded permission-filtered operational event feed. Build online.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_event_operational_cursor"
  ON "IncidentEvent" ("createdAt" DESC, "id" DESC);
