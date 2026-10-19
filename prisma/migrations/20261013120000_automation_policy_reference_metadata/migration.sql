BEGIN;
ALTER TABLE "AutomationVersionPolicyRef" ADD COLUMN "ruleReferences" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AutomationVersionPolicyRef" DISABLE TRIGGER automation_policy_ref_immutable;
-- Backfill immutable lightweight display metadata once, rather than parsing full histories on reads.
UPDATE "AutomationVersionPolicyRef" AS ref
SET "ruleReferences" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', rule->>'id', 'name', rule->>'name', 'enabled', rule->'enabled'))
  FROM jsonb_array_elements(version."snapshot"->'rules') AS rule
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(rule->'actions') AS action
    WHERE action->>'type' = 'USE_ESCALATION_POLICY' AND action->>'policyId' = ref."escalationPolicyId"
  )
), '[]'::jsonb)
FROM "AutomationVersion" AS version WHERE version.id = ref."versionId";

ALTER TABLE "AutomationVersionPolicyRef" ENABLE TRIGGER automation_policy_ref_immutable;
COMMIT;
