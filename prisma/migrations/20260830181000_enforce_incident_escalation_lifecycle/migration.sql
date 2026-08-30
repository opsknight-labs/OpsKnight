CREATE OR REPLACE FUNCTION "opsknight_enforce_incident_escalation_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Terminal responder lifecycle states must never be resurrected into an
  -- active escalation generation by a stale worker write.
  IF NEW."status"::text IN ('ACKNOWLEDGED', 'RESOLVED') THEN
    NEW."escalationStatus" := 'COMPLETED';
    NEW."nextEscalationAt" := NULL;
    NEW."currentEscalationStep" := NULL;
    NEW."escalationProcessingAt" := NULL;
    RETURN NEW;
  END IF;

  -- Muted incidents retain their current step so UNSNOOZE/UNSUPPRESS can use
  -- the domain lifecycle engine's resume semantics, but no worker lease or due
  -- timestamp may remain active while the incident is paused.
  IF NEW."status"::text IN ('SNOOZED', 'SUPPRESSED') THEN
    NEW."escalationStatus" := 'PAUSED';
    NEW."nextEscalationAt" := NULL;
    NEW."escalationProcessingAt" := NULL;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Incident_enforce_escalation_lifecycle" ON "Incident";
CREATE TRIGGER "Incident_enforce_escalation_lifecycle"
BEFORE UPDATE OF
  "status",
  "escalationStatus",
  "nextEscalationAt",
  "currentEscalationStep",
  "escalationProcessingAt"
ON "Incident"
FOR EACH ROW
EXECUTE FUNCTION "opsknight_enforce_incident_escalation_lifecycle"();