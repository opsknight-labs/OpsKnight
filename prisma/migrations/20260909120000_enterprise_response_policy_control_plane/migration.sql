-- Additive, rolling-deploy-safe enterprise response-policy control plane.
ALTER TABLE "IncidentClassificationPolicyRule"
  ADD COLUMN "priorityMode" TEXT NOT NULL DEFAULT 'SET',
  ADD COLUMN "urgencyMode" TEXT NOT NULL DEFAULT 'SET';

-- Preserve the exact semantics of policies created before field modes existed.
ALTER TABLE "IncidentClassificationPolicyRule" DISABLE TRIGGER incident_classification_rule_immutable;
UPDATE "IncidentClassificationPolicyRule"
SET "priorityMode" = CASE WHEN "priority" IS NULL THEN 'CLEAR' ELSE 'SET' END,
    "urgencyMode" = CASE WHEN "urgency" IS NULL THEN 'DEFAULT' ELSE 'SET' END;
ALTER TABLE "IncidentClassificationPolicyRule" ENABLE TRIGGER incident_classification_rule_immutable;

ALTER TABLE "IncidentClassificationPolicyRule"
  ADD CONSTRAINT "classification_priority_mode_valid" CHECK (
    ("priorityMode" = 'SET' AND "priority" IS NOT NULL) OR
    ("priorityMode" IN ('INHERIT', 'CLEAR') AND "priority" IS NULL)
  ),
  ADD CONSTRAINT "classification_urgency_mode_valid" CHECK (
    ("urgencyMode" = 'SET' AND "urgency" IS NOT NULL) OR
    ("urgencyMode" IN ('INHERIT', 'DEFAULT') AND "urgency" IS NULL)
  );

-- Service/integration policies use the existing versioned scope-key architecture.
ALTER TABLE "IncidentClassificationPolicy" DROP CONSTRAINT IF EXISTS "incident_classification_scope";
ALTER TABLE "IncidentClassificationPolicy" DROP CONSTRAINT IF EXISTS "incident_classification_inheritance";
ALTER TABLE "IncidentClassificationPolicy"
  ADD CONSTRAINT "incident_classification_scope" CHECK (
    "scopeKey" = 'workspace' OR "scopeKey" ~ '^service:[A-Za-z0-9_-]+$' OR "scopeKey" ~ '^integration:[A-Za-z0-9_-]+$'
  ),
  ADD CONSTRAINT "incident_classification_inheritance" CHECK (
    ("scopeKey" = 'workspace' AND NOT "inheritWorkspace") OR "scopeKey" <> 'workspace'
  );

ALTER TABLE "Incident"
  ADD COLUMN "classificationPriorityPolicyId" TEXT,
  ADD COLUMN "classificationPriorityPolicyVersion" INTEGER,
  ADD COLUMN "classificationPriorityRule" TEXT,
  ADD COLUMN "classificationPriorityScope" TEXT,
  ADD COLUMN "classificationUrgencyPolicyId" TEXT,
  ADD COLUMN "classificationUrgencyPolicyVersion" INTEGER,
  ADD COLUMN "classificationUrgencyRule" TEXT,
  ADD COLUMN "classificationUrgencyScope" TEXT,
  ADD COLUMN "nextSlaTransitionAt" TIMESTAMP(3),
  ADD COLUMN "nextSlaTransitionKind" TEXT;

CREATE INDEX "idx_incident_next_sla_transition"
  ON "Incident" ("status", "nextSlaTransitionAt");

CREATE TABLE "ResponseSupportHoursPolicy" (
  "id" TEXT PRIMARY KEY,
  "scopeKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL,
  "inheritWorkspace" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "sealedAt" TIMESTAMP(3),
  CONSTRAINT "response_support_scope" CHECK ("scopeKey" = 'workspace' OR "scopeKey" ~ '^service:[A-Za-z0-9_-]+$'),
  CONSTRAINT "response_support_workspace_inheritance" CHECK ("scopeKey" <> 'workspace' OR NOT "inheritWorkspace")
);
CREATE UNIQUE INDEX "ResponseSupportHoursPolicy_scopeKey_version_key"
  ON "ResponseSupportHoursPolicy" ("scopeKey", "version");

CREATE TABLE "ResponseSupportWindow" (
  "id" TEXT PRIMARY KEY,
  "policyId" TEXT NOT NULL REFERENCES "ResponseSupportHoursPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dayOfWeek" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  CONSTRAINT "response_support_window_bounds" CHECK (
    "dayOfWeek" BETWEEN 0 AND 6 AND "startMinute" BETWEEN 0 AND 1439 AND
    "endMinute" BETWEEN 1 AND 1440 AND "endMinute" - "startMinute" >= 15
  )
);
CREATE INDEX "ResponseSupportWindow_policyId_dayOfWeek_idx"
  ON "ResponseSupportWindow" ("policyId", "dayOfWeek");

CREATE TABLE "ResponseSupportException" (
  "id" TEXT PRIMARY KEY,
  "policyId" TEXT NOT NULL REFERENCES "ResponseSupportHoursPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "localDate" DATE NOT NULL,
  "available" BOOLEAN NOT NULL,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  "label" TEXT,
  CONSTRAINT "response_support_exception_window" CHECK (
    (NOT "available" AND "startMinute" IS NULL AND "endMinute" IS NULL) OR
    ("available" AND "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 1 AND 1440 AND "startMinute" < "endMinute")
  )
);
CREATE UNIQUE INDEX "ResponseSupportException_policyId_localDate_key"
  ON "ResponseSupportException" ("policyId", "localDate");

CREATE TABLE "EscalationRuleCondition" (
  "id" TEXT PRIMARY KEY,
  "ruleId" TEXT NOT NULL REFERENCES "EscalationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "field" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "values" TEXT[] NOT NULL,
  CONSTRAINT "escalation_condition_field" CHECK ("field" IN ('PRIORITY','URGENCY','SUPPORT_HOURS_STATE')),
  CONSTRAINT "escalation_condition_operator" CHECK ("operator" IN ('IN','NOT_IN','EQUALS','NOT_EQUALS')),
  CONSTRAINT "escalation_condition_values" CHECK (cardinality("values") BETWEEN 1 AND 10)
);
CREATE INDEX "EscalationRuleCondition_ruleId_idx" ON "EscalationRuleCondition" ("ruleId");

-- Sealed policy history is immutable; restore always publishes a new version.
CREATE FUNCTION opsknight_immutable_support_policy() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."sealedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'response support-hours policies are append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER response_support_policy_immutable
  BEFORE UPDATE OR DELETE ON "ResponseSupportHoursPolicy"
  FOR EACH ROW EXECUTE FUNCTION opsknight_immutable_support_policy();

CREATE FUNCTION opsknight_reject_sealed_support_child_mutation() RETURNS TRIGGER AS $$
DECLARE selected_policy_id TEXT;
BEGIN
  selected_policy_id := COALESCE(NEW."policyId", OLD."policyId");
  IF EXISTS (SELECT 1 FROM "ResponseSupportHoursPolicy" WHERE "id" = selected_policy_id AND "sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'sealed support-hours configuration is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER response_support_window_immutable BEFORE INSERT OR UPDATE OR DELETE ON "ResponseSupportWindow"
  FOR EACH ROW EXECUTE FUNCTION opsknight_reject_sealed_support_child_mutation();
CREATE TRIGGER response_support_exception_immutable BEFORE INSERT OR UPDATE OR DELETE ON "ResponseSupportException"
  FOR EACH ROW EXECUTE FUNCTION opsknight_reject_sealed_support_child_mutation();
