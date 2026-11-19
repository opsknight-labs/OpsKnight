-- Hot-path index for held incidents per window. Built online so incident writes
-- (alert ingestion) are never blocked; kept alone because CONCURRENTLY can't run
-- inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Incident_maintenanceWindowId_status_idx"
  ON "Incident" ("maintenanceWindowId", "status");
