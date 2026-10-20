-- Backfill existing legacy observations without a recorded source based on integrationType
UPDATE "AutomationContextObservation"
SET "source" = CASE
  WHEN "integrationType" = 'EVENTS_API' THEN 'EVENT'
  ELSE 'PROVIDER'
END
WHERE "source" IS NULL;

-- Drop predecessor unique index that excluded sourcePath and source
DROP INDEX IF EXISTS "AutomationContextObservation_serviceId_integrationId_fieldK_key";

-- Create unique index distinguishing provenance source and sourcePath
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationContextObservation_provenance_key"
  ON "AutomationContextObservation"("serviceId", "integrationId", "fieldKey", "sourcePath", "normalizedRawValueHash", "source");
