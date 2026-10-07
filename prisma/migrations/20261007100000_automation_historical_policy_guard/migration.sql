-- Resolved incidents retain their immutable routes and can be reopened later.
CREATE OR REPLACE FUNCTION automation_policy_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AutomationVersionPolicyRef" r JOIN "ServiceAutomationConfig" c ON c."activeVersionId" = r."versionId" WHERE r."escalationPolicyId" = OLD.id)
  OR EXISTS (SELECT 1 FROM "IncidentAutomationDecision" d WHERE d."escalationPolicyId" = OLD.id) THEN
    RAISE EXCEPTION 'Policy is referenced by active automation or a historical incident decision';
  END IF;
  RETURN OLD;
END $$;

-- Fence decision insertion against concurrent physical deletion too.
CREATE FUNCTION automation_decision_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."escalationPolicyId" IS NOT NULL THEN
    PERFORM 1 FROM "EscalationPolicy" WHERE id = NEW."escalationPolicyId" FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Incident routing policy is missing'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_decision_policy_guard BEFORE INSERT ON "IncidentAutomationDecision"
FOR EACH ROW EXECUTE FUNCTION automation_decision_policy_guard();
