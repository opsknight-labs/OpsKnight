-- Immutable destination identity: tombstone on routing change, at most one enabled per service
-- Prior model used `serviceId @unique` which reused the same row/id when a service was
-- relinked from Team A to Team B, mixing old conversation/activity state into the new
-- route and breaking AMBIGUOUS reconciliation. New invariant: (serviceId,tenantId,teamId,channelId)
-- is the immutable identity per row; routing changes tombstone the old enabled row
-- (enabled=false) and create a new row with a new id. Enforced by partial unique index.

-- Drop the legacy single-column unique that enforced one row per service
DROP INDEX IF EXISTS "MicrosoftTeamsDestination_serviceId_key";

-- Composite identity (service + channel tuple) — was added in 20260915100000 but ensure idempotent
CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_serviceId_tenantId_teamId_channelId_key"
  ON "MicrosoftTeamsDestination"("serviceId", "tenantId", "teamId", "channelId");

-- Lookup for enabled-per-service queries (covers findFirst where serviceId and enabled)
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_serviceId_idx"
  ON "MicrosoftTeamsDestination"("serviceId");

-- At most one enabled destination per service
CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_serviceId_enabled_true"
  ON "MicrosoftTeamsDestination"("serviceId") WHERE "enabled" = true;
