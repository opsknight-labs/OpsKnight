-- Escalation policy and execution invariants.
--
-- The application validates these on every write, but a policy step is an
-- instruction the engine must be able to execute months later. These are the
-- backstop for anything that reaches the table another way.

-- 1. Step delay must be a sane number of minutes.
--
-- Normalized first so the constraint can be added VALID: a negative delay is
-- unambiguously "immediately", and anything past the 7-day cap is a typo that
-- would otherwise park an incident's escalation for months.
UPDATE "EscalationRule" SET "delayMinutes" = 0 WHERE "delayMinutes" < 0;
UPDATE "EscalationRule" SET "delayMinutes" = 10080 WHERE "delayMinutes" > 10080;

ALTER TABLE "EscalationRule"
DROP CONSTRAINT IF EXISTS "EscalationRule_delayMinutes_range";
ALTER TABLE "EscalationRule"
ADD CONSTRAINT "EscalationRule_delayMinutes_range"
CHECK ("delayMinutes" >= 0 AND "delayMinutes" <= 10080);

-- 2. A step's target type and its target id must agree, and it must carry
-- exactly one target id.
--
-- NOT VALID: an existing row whose type and id disagree cannot be repaired
-- automatically — which target the author meant is not recoverable. Those rows
-- stay visible, and the engine reports them as INVALID_TARGET, while no new
-- row can be written that way.
ALTER TABLE "EscalationRule"
DROP CONSTRAINT IF EXISTS "EscalationRule_target_consistency";
ALTER TABLE "EscalationRule"
ADD CONSTRAINT "EscalationRule_target_consistency"
CHECK (
  CASE "targetType"
    WHEN 'USER' THEN "targetUserId" IS NOT NULL AND "targetTeamId" IS NULL AND "targetScheduleId" IS NULL
    WHEN 'TEAM' THEN "targetTeamId" IS NOT NULL AND "targetUserId" IS NULL AND "targetScheduleId" IS NULL
    WHEN 'SCHEDULE' THEN "targetScheduleId" IS NOT NULL AND "targetUserId" IS NULL AND "targetTeamId" IS NULL
  END
) NOT VALID;

-- 3. Escalation execution status is a closed set.
--
-- Still a text column: promoting it to an enum needs a coordinated deploy,
-- because a rolling release would have old replicas writing the old type.
-- NOT VALID for the same reason as above — a legacy row carrying an
-- unrecognised status must stay readable.
ALTER TABLE "Incident"
DROP CONSTRAINT IF EXISTS "Incident_escalationStatus_known";
ALTER TABLE "Incident"
ADD CONSTRAINT "Incident_escalationStatus_known"
CHECK ("escalationStatus" IS NULL OR "escalationStatus" IN ('ESCALATING', 'PAUSED', 'COMPLETED', 'FAILED'))
NOT VALID;

-- 4. An incident may not be newly assigned to a responder who cannot respond.
--
-- Deliberately only checked when the assignee actually changes. Enforcing it on
-- every update would make an incident unmodifiable the moment its assignee is
-- deactivated, which would block the very lifecycle transitions needed to
-- reassign it.
CREATE OR REPLACE FUNCTION "opsknight_enforce_active_incident_assignee"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."assigneeId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."assigneeId" IS NOT DISTINCT FROM OLD."assigneeId" THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."assigneeId" AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Incident % cannot be assigned to inactive user %',
      NEW."id", NEW."assigneeId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Incident_enforce_active_assignee" ON "Incident";
CREATE TRIGGER "Incident_enforce_active_assignee"
BEFORE INSERT OR UPDATE OF "assigneeId"
ON "Incident"
FOR EACH ROW
EXECUTE FUNCTION "opsknight_enforce_active_incident_assignee"();
