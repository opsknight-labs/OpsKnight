-- Additive enterprise response-policy control plane. The temporary normalization
-- trigger keeps legacy writers compatible while replicas are upgraded.
ALTER TABLE "IncidentClassificationPolicyRule"
  ADD COLUMN "priorityMode" TEXT,
  ADD COLUMN "urgencyMode" TEXT;

ALTER TABLE "IncidentClassificationPolicy"
  ADD COLUMN "priorityFallbackMode" TEXT;
ALTER TABLE "IncidentClassificationPolicy" DISABLE TRIGGER incident_classification_policy_immutable;
UPDATE "IncidentClassificationPolicy"
SET "priorityFallbackMode" = CASE
  WHEN "derivePriorityFromUrgency" THEN 'ENABLED'
  WHEN "scopeKey" = 'workspace' THEN 'DISABLED'
  ELSE 'INHERIT'
END;
ALTER TABLE "IncidentClassificationPolicy" ENABLE TRIGGER incident_classification_policy_immutable;
ALTER TABLE "IncidentClassificationPolicy"
  ALTER COLUMN "priorityFallbackMode" SET NOT NULL,
  ALTER COLUMN "priorityFallbackMode" SET DEFAULT 'INHERIT',
  ADD CONSTRAINT "incident_classification_fallback_mode" CHECK (
    ("scopeKey" = 'workspace' AND "priorityFallbackMode" IN ('ENABLED', 'DISABLED')) OR
    ("scopeKey" <> 'workspace' AND "priorityFallbackMode" IN ('INHERIT', 'ENABLED', 'DISABLED'))
  );

CREATE FUNCTION opsknight_normalize_legacy_classification_policy() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."derivePriorityFromUrgency" AND
     (NEW."priorityFallbackMode" IS NULL OR NEW."priorityFallbackMode" = 'INHERIT') THEN
    NEW."priorityFallbackMode" := 'ENABLED';
  ELSIF NEW."scopeKey" = 'workspace' AND
        (NEW."priorityFallbackMode" IS NULL OR NEW."priorityFallbackMode" = 'INHERIT') THEN
    NEW."priorityFallbackMode" := 'DISABLED';
  ELSIF NEW."priorityFallbackMode" IS NULL THEN
    NEW."priorityFallbackMode" := 'INHERIT';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER incident_classification_policy_legacy_compat
  BEFORE INSERT ON "IncidentClassificationPolicy"
  FOR EACH ROW EXECUTE FUNCTION opsknight_normalize_legacy_classification_policy();

-- Preserve the exact semantics of policies created before field modes existed.
ALTER TABLE "IncidentClassificationPolicyRule" DISABLE TRIGGER incident_classification_rule_immutable;
UPDATE "IncidentClassificationPolicyRule"
SET "priorityMode" = CASE
      WHEN "priority" IS NOT NULL THEN 'SET'
      WHEN EXISTS (
        SELECT 1 FROM "IncidentClassificationPolicy" policy
        WHERE policy."id" = "IncidentClassificationPolicyRule"."policyId"
          AND policy."derivePriorityFromUrgency"
      ) THEN 'INHERIT'
      ELSE 'CLEAR'
    END,
    "urgencyMode" = CASE WHEN "urgency" IS NULL THEN 'DEFAULT' ELSE 'SET' END;
ALTER TABLE "IncidentClassificationPolicyRule" ENABLE TRIGGER incident_classification_rule_immutable;

CREATE FUNCTION opsknight_normalize_legacy_classification_rule() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."priorityMode" IS NULL THEN
    IF NEW."priority" IS NOT NULL THEN
      NEW."priorityMode" := 'SET';
    ELSIF EXISTS (
      SELECT 1 FROM "IncidentClassificationPolicy" policy
      WHERE policy."id" = NEW."policyId" AND policy."derivePriorityFromUrgency"
    ) THEN
      NEW."priorityMode" := 'INHERIT';
    ELSE
      NEW."priorityMode" := 'CLEAR';
    END IF;
  END IF;
  IF NEW."urgencyMode" IS NULL THEN
    NEW."urgencyMode" := CASE WHEN NEW."urgency" IS NULL THEN 'DEFAULT' ELSE 'SET' END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER incident_classification_rule_legacy_compat
  BEFORE INSERT ON "IncidentClassificationPolicyRule"
  FOR EACH ROW EXECUTE FUNCTION opsknight_normalize_legacy_classification_rule();

ALTER TABLE "IncidentClassificationPolicyRule"
  ALTER COLUMN "priorityMode" SET NOT NULL,
  ALTER COLUMN "urgencyMode" SET NOT NULL;

ALTER TABLE "IncidentClassificationPolicyRule"
  DROP CONSTRAINT IF EXISTS "incident_classification_rule_effect";

ALTER TABLE "IncidentClassificationPolicyRule"
  ADD CONSTRAINT "classification_priority_mode_valid" CHECK (
    ("priorityMode" = 'SET' AND "priority" IS NOT NULL) OR
    ("priorityMode" IN ('INHERIT', 'FALLBACK', 'CLEAR') AND "priority" IS NULL)
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

ALTER TABLE "Incident"
  ADD CONSTRAINT "Incident_classificationPriorityPolicyId_fkey"
    FOREIGN KEY ("classificationPriorityPolicyId") REFERENCES "IncidentClassificationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Incident_classificationUrgencyPolicyId_fkey"
    FOREIGN KEY ("classificationUrgencyPolicyId") REFERENCES "IncidentClassificationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "incident_next_sla_transition_kind" CHECK (
    "nextSlaTransitionKind" IS NULL OR "nextSlaTransitionKind" IN
      ('ACK_WARNING', 'ACK_BREACH', 'RESOLVE_WARNING', 'RESOLVE_BREACH')
  );

-- The index is installed concurrently by the deployment operation after this
-- transactional schema migration. INDEXED mode must remain unavailable until
-- readiness confirms that index exists.

CREATE TABLE "ResponseSupportHoursPolicy" (
  "id" TEXT PRIMARY KEY,
  "scopeKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL,
  "inheritWorkspace" BOOLEAN NOT NULL DEFAULT false,
  "mode" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "sealedAt" TIMESTAMP(3),
  CONSTRAINT "response_support_scope" CHECK ("scopeKey" = 'workspace' OR "scopeKey" ~ '^service:[A-Za-z0-9_-]+$'),
  CONSTRAINT "response_support_workspace_inheritance" CHECK ("scopeKey" <> 'workspace' OR NOT "inheritWorkspace"),
  CONSTRAINT "response_support_mode" CHECK (
    ("scopeKey" = 'workspace' AND "mode" IN ('ALWAYS', 'SCHEDULED')) OR
    ("scopeKey" <> 'workspace' AND "mode" IN ('INHERIT', 'ALWAYS', 'SCHEDULED'))
  )
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

CREATE FUNCTION opsknight_reject_overlapping_support_windows() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ResponseSupportWindow" existing
    WHERE existing."policyId" = NEW."policyId"
      AND existing."dayOfWeek" = NEW."dayOfWeek"
      AND existing."id" <> NEW."id"
      AND int4range(existing."startMinute", existing."endMinute", '[)') &&
          int4range(NEW."startMinute", NEW."endMinute", '[)')
  ) THEN
    RAISE EXCEPTION 'support-hour windows cannot overlap' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER response_support_window_no_overlap
  BEFORE INSERT OR UPDATE ON "ResponseSupportWindow"
  FOR EACH ROW EXECUTE FUNCTION opsknight_reject_overlapping_support_windows();

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
    ("available" AND "startMinute" IS NOT NULL AND "endMinute" IS NOT NULL AND
     "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 1 AND 1440 AND "startMinute" < "endMinute")
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
  RETURN COALESCE(NEW, OLD);
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
