-- Allow multiple active Microsoft Teams destinations per service (up to 3 channels)
-- Drop the single-enabled-per-service partial unique index.
DROP INDEX IF EXISTS "MicrosoftTeamsDestination_serviceId_enabled_true";

-- Add composite index for fast lookups of active destinations per service
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_serviceId_enabled_idx"
  ON "MicrosoftTeamsDestination"("serviceId", "enabled");
