-- Keyset cursor for the Squire knowledge sync over postmortems; built without blocking writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_postmortem_updated_id"
ON "Postmortem" ("updatedAt", "id");
