-- Existing decisions predate behavior pinning. Capture the definition available
-- at upgrade; edits before this migration cannot be reconstructed retroactively.
-- The explicit transaction keeps the temporary trigger suspension unobservable.
BEGIN;
ALTER TABLE "IncidentAutomationDecision" DISABLE TRIGGER automation_decision_immutable;
UPDATE "IncidentAutomationDecision" d
SET summary = d.summary || jsonb_build_object('responderPolicy', jsonb_build_object(
  'id', p.id, 'name', p.name,
  'steps', COALESCE((SELECT jsonb_agg(
    to_jsonb(s) || jsonb_build_object('conditions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('field', c.field, 'operator', c.operator, 'values', c.values) ORDER BY c.id)
      FROM "EscalationRuleCondition" c WHERE c."ruleId" = s.id
    ), '[]'::jsonb)) ORDER BY s."stepOrder")
    FROM "EscalationRule" s WHERE s."policyId" = p.id), '[]'::jsonb)
))
FROM "EscalationPolicy" p
WHERE d.mode = 'LIVE' AND d."escalationPolicyId" = p.id
AND NOT (d.summary ? 'responderPolicy');
ALTER TABLE "IncidentAutomationDecision" ENABLE TRIGGER automation_decision_immutable;

CREATE OR REPLACE FUNCTION automation_policy_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AutomationVersionPolicyRef" r WHERE r."escalationPolicyId" = OLD.id)
  OR EXISTS (SELECT 1 FROM "IncidentAutomationDecision" d WHERE d."escalationPolicyId" = OLD.id) THEN
    RAISE EXCEPTION 'Policy is referenced by published automation history or an incident decision';
  END IF;
  RETURN OLD;
END $$;
COMMIT;
