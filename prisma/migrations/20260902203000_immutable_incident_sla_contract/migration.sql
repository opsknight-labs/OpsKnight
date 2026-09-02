-- Freeze the effective SLA contract on incidents and daily SLA materializations.
-- This makes historical compliance stable when service or SLA policy configuration changes.

ALTER TABLE "Incident"
  ADD COLUMN "slaAckTargetMs" INTEGER,
  ADD COLUMN "slaResolveTargetMs" INTEGER,
  ADD COLUMN "slaTargetSource" TEXT,
  ADD COLUMN "slaTargetCapturedAt" TIMESTAMP(3);

-- Canonical priority backfill. This is explicitly marked as a migration-time
-- reconstruction because pre-migration policy versions were not stored on incidents.
UPDATE "Incident"
SET
  "slaAckTargetMs" = CASE CONCAT('P', REGEXP_REPLACE(BTRIM(UPPER(COALESCE("priority", ''))), '^P', ''))
    WHEN 'P1' THEN 300000
    WHEN 'P2' THEN 900000
    WHEN 'P3' THEN 1800000
    WHEN 'P4' THEN 3600000
    WHEN 'P5' THEN 7200000
  END,
  "slaResolveTargetMs" = CASE CONCAT('P', REGEXP_REPLACE(BTRIM(UPPER(COALESCE("priority", ''))), '^P', ''))
    WHEN 'P1' THEN 3600000
    WHEN 'P2' THEN 14400000
    WHEN 'P3' THEN 28800000
    WHEN 'P4' THEN 86400000
    WHEN 'P5' THEN 172800000
  END,
  "slaTargetSource" = 'PRIORITY_BACKFILL_CANONICAL',
  "slaTargetCapturedAt" = CURRENT_TIMESTAMP
WHERE CONCAT('P', REGEXP_REPLACE(BTRIM(UPPER(COALESCE("priority", ''))), '^P', '')) IN ('P1', 'P2', 'P3', 'P4', 'P5');

-- Service-scoped legacy incidents cannot be reconstructed exactly because historical
-- service targets were never versioned. Freeze the best available current value and
-- retain provenance rather than silently pretending it is original history.
UPDATE "Incident" AS i
SET
  "slaAckTargetMs" = COALESCE(NULLIF(s."targetAckMinutes", 0), 15) * 60000,
  "slaResolveTargetMs" = COALESCE(NULLIF(s."targetResolveMinutes", 0), 120) * 60000,
  "slaTargetSource" = 'SERVICE_BACKFILL_CURRENT',
  "slaTargetCapturedAt" = CURRENT_TIMESTAMP
FROM "Service" AS s
WHERE i."slaAckTargetMs" IS NULL
  AND s."id" = i."serviceId";

UPDATE "Incident"
SET
  "slaAckTargetMs" = 900000,
  "slaResolveTargetMs" = 7200000,
  "slaTargetSource" = 'DEFAULT_BACKFILL',
  "slaTargetCapturedAt" = CURRENT_TIMESTAMP
WHERE "slaAckTargetMs" IS NULL;

CREATE OR REPLACE FUNCTION opsknight_capture_incident_sla_target()
RETURNS TRIGGER AS $$
DECLARE
  normalized_priority TEXT;
  ack_minutes INTEGER;
  resolve_minutes INTEGER;
BEGIN
  IF NEW."slaAckTargetMs" IS NOT NULL AND NEW."slaAckTargetMs" > 0
     AND NEW."slaResolveTargetMs" IS NOT NULL AND NEW."slaResolveTargetMs" > 0 THEN
    NEW."slaTargetSource" := COALESCE(NULLIF(NEW."slaTargetSource", ''), 'EXPLICIT');
    NEW."slaTargetCapturedAt" := COALESCE(NEW."slaTargetCapturedAt", CURRENT_TIMESTAMP);
    RETURN NEW;
  END IF;

  normalized_priority := CONCAT('P', REGEXP_REPLACE(BTRIM(UPPER(COALESCE(NEW."priority", ''))), '^P', ''));
  CASE normalized_priority
    WHEN 'P1' THEN ack_minutes := 5; resolve_minutes := 60;
    WHEN 'P2' THEN ack_minutes := 15; resolve_minutes := 240;
    WHEN 'P3' THEN ack_minutes := 30; resolve_minutes := 480;
    WHEN 'P4' THEN ack_minutes := 60; resolve_minutes := 1440;
    WHEN 'P5' THEN ack_minutes := 120; resolve_minutes := 2880;
    ELSE
      SELECT NULLIF("targetAckMinutes", 0), NULLIF("targetResolveMinutes", 0)
      INTO ack_minutes, resolve_minutes
      FROM "Service"
      WHERE "id" = NEW."serviceId";
  END CASE;

  IF normalized_priority IN ('P1', 'P2', 'P3', 'P4', 'P5') THEN
    NEW."slaTargetSource" := 'PRIORITY';
  ELSIF ack_minutes IS NOT NULL OR resolve_minutes IS NOT NULL THEN
    NEW."slaTargetSource" := 'SERVICE';
  ELSE
    NEW."slaTargetSource" := 'DEFAULT';
  END IF;

  NEW."slaAckTargetMs" := COALESCE(ack_minutes, 15) * 60000;
  NEW."slaResolveTargetMs" := COALESCE(resolve_minutes, 120) * 60000;
  NEW."slaTargetCapturedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER incident_capture_sla_target
BEFORE INSERT ON "Incident"
FOR EACH ROW EXECUTE FUNCTION opsknight_capture_incident_sla_target();

ALTER TABLE "Incident"
  ADD CONSTRAINT incident_sla_target_contract_check CHECK (
    "slaAckTargetMs" IS NOT NULL AND "slaAckTargetMs" > 0
    AND "slaResolveTargetMs" IS NOT NULL AND "slaResolveTargetMs" > 0
    AND "slaTargetSource" IS NOT NULL AND BTRIM("slaTargetSource") <> ''
    AND "slaTargetCapturedAt" IS NOT NULL
  );

CREATE OR REPLACE FUNCTION opsknight_prevent_incident_sla_target_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."slaAckTargetMs" IS DISTINCT FROM OLD."slaAckTargetMs"
     OR NEW."slaResolveTargetMs" IS DISTINCT FROM OLD."slaResolveTargetMs"
     OR NEW."slaTargetSource" IS DISTINCT FROM OLD."slaTargetSource"
     OR NEW."slaTargetCapturedAt" IS DISTINCT FROM OLD."slaTargetCapturedAt" THEN
    RAISE EXCEPTION 'incident SLA target contract is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER incident_prevent_sla_target_mutation
BEFORE UPDATE ON "Incident"
FOR EACH ROW EXECUTE FUNCTION opsknight_prevent_incident_sla_target_mutation();

ALTER TABLE "SLASnapshot"
  ADD COLUMN "targetAckMinutes" INTEGER,
  ADD COLUMN "targetResolveMinutes" INTEGER,
  ADD COLUMN "definitionVersion" INTEGER,
  ADD COLUMN "targetCapturedAt" TIMESTAMP(3),
  ADD COLUMN "targetSource" TEXT;

UPDATE "SLASnapshot" AS ss
SET
  "targetAckMinutes" = d."targetAckTime",
  "targetResolveMinutes" = d."targetResolveTime",
  "definitionVersion" = d."version",
  "targetCapturedAt" = CURRENT_TIMESTAMP,
  "targetSource" = 'DEFINITION_BACKFILL_CURRENT'
FROM "SLADefinition" AS d
WHERE d."id" = ss."slaDefinitionId";

CREATE OR REPLACE FUNCTION opsknight_capture_sla_snapshot_target()
RETURNS TRIGGER AS $$
DECLARE
  definition_record "SLADefinition"%ROWTYPE;
BEGIN
  SELECT * INTO definition_record
  FROM "SLADefinition"
  WHERE "id" = NEW."slaDefinitionId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLA definition % not found', NEW."slaDefinitionId" USING ERRCODE = '23503';
  END IF;

  NEW."targetAckMinutes" := COALESCE(NEW."targetAckMinutes", definition_record."targetAckTime");
  NEW."targetResolveMinutes" := COALESCE(NEW."targetResolveMinutes", definition_record."targetResolveTime");
  NEW."definitionVersion" := COALESCE(NEW."definitionVersion", definition_record."version");
  NEW."targetCapturedAt" := COALESCE(NEW."targetCapturedAt", CURRENT_TIMESTAMP);
  NEW."targetSource" := COALESCE(NULLIF(NEW."targetSource", ''), 'DEFINITION_CAPTURED');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sla_snapshot_capture_target
BEFORE INSERT ON "SLASnapshot"
FOR EACH ROW EXECUTE FUNCTION opsknight_capture_sla_snapshot_target();

ALTER TABLE "SLASnapshot"
  ADD CONSTRAINT sla_snapshot_target_contract_check CHECK (
    "definitionVersion" IS NOT NULL AND "definitionVersion" > 0
    AND "targetCapturedAt" IS NOT NULL
    AND "targetSource" IS NOT NULL AND BTRIM("targetSource") <> ''
    AND ("targetAckMinutes" IS NULL OR "targetAckMinutes" > 0)
    AND ("targetResolveMinutes" IS NULL OR "targetResolveMinutes" > 0)
  );

CREATE OR REPLACE FUNCTION opsknight_prevent_sla_snapshot_target_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."targetAckMinutes" IS DISTINCT FROM OLD."targetAckMinutes"
     OR NEW."targetResolveMinutes" IS DISTINCT FROM OLD."targetResolveMinutes"
     OR NEW."definitionVersion" IS DISTINCT FROM OLD."definitionVersion"
     OR NEW."targetCapturedAt" IS DISTINCT FROM OLD."targetCapturedAt"
     OR NEW."targetSource" IS DISTINCT FROM OLD."targetSource" THEN
    RAISE EXCEPTION 'SLA snapshot target contract is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sla_snapshot_prevent_target_mutation
BEFORE UPDATE ON "SLASnapshot"
FOR EACH ROW EXECUTE FUNCTION opsknight_prevent_sla_snapshot_target_mutation();
