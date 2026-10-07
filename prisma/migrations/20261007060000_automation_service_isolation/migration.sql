-- Enforce tenant/service identity even for direct database clients.
CREATE FUNCTION automation_incident_service_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Incident" WHERE id = NEW."incidentId" AND "serviceId" = NEW."serviceId") THEN
    RAISE EXCEPTION 'Automation incident belongs to another service';
  END IF;
  IF NEW."versionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AutomationVersion" WHERE id = NEW."versionId" AND "serviceId" = NEW."serviceId") THEN
    RAISE EXCEPTION 'Automation version belongs to another service';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_decision_service_guard BEFORE INSERT ON "IncidentAutomationDecision" FOR EACH ROW EXECUTE FUNCTION automation_incident_service_guard();
CREATE TRIGGER automation_trace_service_guard BEFORE INSERT OR UPDATE ON "AutomationTrace" FOR EACH ROW EXECUTE FUNCTION automation_incident_service_guard();
CREATE TRIGGER automation_policy_ref_immutable BEFORE UPDATE ON "AutomationVersionPolicyRef" FOR EACH ROW EXECUTE FUNCTION automation_reject_update();
