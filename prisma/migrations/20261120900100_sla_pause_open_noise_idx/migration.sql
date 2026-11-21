-- Noise sweep probe/page: only incidents held by an open noise-control pause. Partial, so it stays tiny.
-- The predicate literal must match the sweep's SQL exactly for the planner to use it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sla_pause_open_noise"
ON "IncidentSlaPause" ("incidentId")
WHERE "endedAt" IS NULL AND reason = 'noise-control-suppression';
