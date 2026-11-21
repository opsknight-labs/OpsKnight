-- Latest alert per key on an incident (DISTINCT ON "dedupKey" ORDER BY "dedupKey", "createdAt" DESC, id DESC):
-- every resolve counts the incident's other firing keys, and the storm cascade counts a child's. DESC matches
-- that order; INCLUDE (status) keeps it index-only. Not mirrored in schema.prisma (Prisma cannot express
-- INCLUDE). Kept alone and without SET timeouts because CONCURRENTLY can't run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_incident_key_latest"
  ON "Alert" ("incidentId", "dedupKey", "createdAt" DESC, id DESC) INCLUDE (status);
