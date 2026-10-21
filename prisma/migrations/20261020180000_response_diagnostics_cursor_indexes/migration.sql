-- Bounded incident execution timeline. Build online.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_runbook_execution_incident_cursor"
  ON "RunbookExecution" ("incidentId", "createdAt" DESC, "id" DESC);
