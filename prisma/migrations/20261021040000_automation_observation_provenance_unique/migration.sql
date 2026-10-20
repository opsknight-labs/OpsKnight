-- Migration: 20261021040000_automation_observation_provenance_unique
-- Coordinated Migration / Worker Cutover Certification:
-- Workers running the predecessor release execute ON CONFLICT against the 4-column index
-- ("serviceId", "integrationId", "fieldKey", "normalizedRawValueHash").
-- When rolling out this migration, background workers (opsknight-general-worker and integrated
-- replicas) must be drained and stopped before applying schema migrations, or replaced via
-- coordinated cutover (spec.replicas: 0 -> apply migration -> scale new release replicas).
--
-- Historical Provenance:
-- Legacy observations retain source IS NULL (provenance-unknown). Do not backfill by guessing.
-- NULLS NOT DISTINCT ensures historical NULL source observations remain uniquely constrained.

-- Drop predecessor unique index that excluded sourcePath and source
DROP INDEX IF EXISTS "AutomationContextObservation_serviceId_integrationId_fieldK_key";

-- Create unique index distinguishing provenance source and sourcePath.
-- NULLS NOT DISTINCT treats multiple NULL sources as duplicate keys in PostgreSQL 15+.
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationContextObservation_provenance_key"
  ON "AutomationContextObservation"("serviceId", "integrationId", "fieldKey", "sourcePath", "normalizedRawValueHash", "source")
  NULLS NOT DISTINCT;
