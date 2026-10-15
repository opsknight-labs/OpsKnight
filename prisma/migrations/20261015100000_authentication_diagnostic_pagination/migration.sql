-- Read-only diagnostic projection; authentication still validates original signed metadata.
ALTER TABLE "UserDevice" ADD COLUMN "sessionPolicyVersion" INTEGER;
-- Invalid historical metadata remains fail-closed. Never cast arbitrary token text directly.
CREATE FUNCTION pg_temp.auth_diagnostic_version(metadata TEXT) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE value JSONB; version NUMERIC;
BEGIN
  value := metadata::jsonb;
  IF NOT value ? 'issuedUnderPolicyVersion' OR value->'issuedUnderPolicyVersion' = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(value->'issuedUnderPolicyVersion') <> 'number' THEN RETURN -1; END IF;
  version := (value->>'issuedUnderPolicyVersion')::numeric;
  IF version <> trunc(version) OR version < 1 OR version > 2147483647 THEN RETURN -1; END IF;
  RETURN version::integer;
EXCEPTION WHEN OTHERS THEN RETURN -1;
END;
$$;
UPDATE "UserDevice" SET "sessionPolicyVersion" = pg_temp.auth_diagnostic_version(token) WHERE "deviceId" LIKE 'session:%';
-- Earlier session expiry was nullable; safely project valid historical ISO timestamps.
CREATE FUNCTION pg_temp.auth_diagnostic_expiry(metadata TEXT) RETURNS TIMESTAMP(3) LANGUAGE plpgsql AS $$
DECLARE value TEXT;
BEGIN
  value := metadata::jsonb->>'expiresAt';
  IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T' THEN RETURN NULL; END IF;
  RETURN (value::timestamptz AT TIME ZONE 'UTC');
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
UPDATE "UserDevice" SET "sessionExpiresAt" = pg_temp.auth_diagnostic_expiry(token)
WHERE "deviceId" LIKE 'session:%' AND "sessionExpiresAt" IS NULL;
CREATE INDEX "UserDevice_diagnostic_activity_idx" ON "UserDevice"("lastUsed",id);
CREATE INDEX "UserDevice_diagnostic_created_idx" ON "UserDevice"("createdAt",id);
CREATE INDEX "UserDevice_diagnostic_expiry_idx" ON "UserDevice"("sessionExpiresAt",id);
CREATE INDEX "EmergencyAccessEvent_page_idx" ON "EmergencyAccessEvent"("createdAt",id);
CREATE INDEX "EmergencyAccessEvent_type_page_idx" ON "EmergencyAccessEvent"("eventType","createdAt",id);
CREATE INDEX "EmergencyAccessEvent_outcome_page_idx" ON "EmergencyAccessEvent"(outcome,"createdAt",id);
CREATE INDEX "AuthenticationReplicaObservation_page_idx" ON "AuthenticationReplicaObservation"("lastSeenAt",id);
