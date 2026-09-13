-- A shared operations channel may intentionally receive incidents from more
-- than one OpsKnight service. Keep idempotency scoped to the service route.
DROP INDEX IF EXISTS "MicrosoftTeamsDestination_tenantId_teamId_channelId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_serviceId_tenantId_teamId_channelId_key"
  ON "MicrosoftTeamsDestination"("serviceId", "tenantId", "teamId", "channelId");
