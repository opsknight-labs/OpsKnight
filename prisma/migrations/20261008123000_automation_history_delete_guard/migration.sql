-- Direct history deletion is forbidden. The incident/service parent lifecycle
-- may cascade its own history after that parent is no longer visible.
CREATE FUNCTION automation_history_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'IncidentAutomationDecision' THEN
    IF EXISTS (SELECT 1 FROM "Incident" WHERE id = OLD."incidentId") THEN
      RAISE EXCEPTION 'Incident automation decisions cannot be directly deleted';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "Service" WHERE id = OLD."serviceId") THEN
      RAISE EXCEPTION 'Published automation versions cannot be directly deleted';
    END IF;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER automation_version_delete_guard BEFORE DELETE ON "AutomationVersion"
FOR EACH ROW EXECUTE FUNCTION automation_history_delete_guard();
CREATE TRIGGER automation_decision_delete_guard BEFORE DELETE ON "IncidentAutomationDecision"
FOR EACH ROW EXECUTE FUNCTION automation_history_delete_guard();
