-- Keyset cursor for the Squire knowledge sync over incident notes; built without blocking writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_incident_note_created_id"
ON "IncidentNote" ("createdAt", "id");
