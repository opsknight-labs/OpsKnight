BEGIN;
-- Expand only: the historical backfill is a separate migration so Incident is not locked while it runs.
ALTER TABLE "Incident" ADD COLUMN "automationSourceRestricted" BOOLEAN NOT NULL DEFAULT false;
-- Writers from the previous release may still create traces during a rolling upgrade.
CREATE FUNCTION automation_capture_source_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Incident" SET "automationSourceRestricted" = true
  WHERE id = NEW."incidentId" AND NOT "automationSourceRestricted";
  RETURN NEW;
END $$;
CREATE TRIGGER automation_decision_source_classification AFTER INSERT ON "IncidentAutomationDecision"
FOR EACH ROW EXECUTE FUNCTION automation_capture_source_classification();
CREATE TRIGGER automation_shadow_source_classification AFTER INSERT ON "AutomationTrace"
FOR EACH ROW WHEN (NEW.mode = 'SHADOW') EXECUTE FUNCTION automation_capture_source_classification();

CREATE FUNCTION automation_preserve_source_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."automationSourceRestricted" AND NOT NEW."automationSourceRestricted" THEN
    RAISE EXCEPTION 'Incident source privacy classification cannot be removed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_source_classification_guard BEFORE UPDATE OF "automationSourceRestricted" ON "Incident"
FOR EACH ROW EXECUTE FUNCTION automation_preserve_source_classification();

COMMIT;
