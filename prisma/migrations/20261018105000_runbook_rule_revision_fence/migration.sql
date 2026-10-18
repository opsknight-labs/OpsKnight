-- All writers participate in the rule's validator, including nested trigger edits.
CREATE FUNCTION fence_service_runbook_rule_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."configurationRevision" := OLD."configurationRevision" + 1;
  IF NEW.mode = 'AUTOMATIC' AND ROW(NEW.name, NEW."runbookId", NEW."runbookVersionId",
      NEW.mode, NEW."versionStrategy", NEW."defaultAgentPoolId", NEW."defaultAgentId",
      NEW."agentSelector", NEW."inputValues") IS DISTINCT FROM
    ROW(OLD.name, OLD."runbookId", OLD."runbookVersionId", OLD.mode,
      OLD."versionStrategy", OLD."defaultAgentPoolId", OLD."defaultAgentId",
      OLD."agentSelector", OLD."inputValues") THEN
    NEW.enabled := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER service_runbook_rule_revision_before_update BEFORE UPDATE ON "ServiceRunbookBinding"
FOR EACH ROW EXECUTE FUNCTION fence_service_runbook_rule_revision();

CREATE FUNCTION fence_runbook_trigger_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END;
$$;
CREATE TRIGGER runbook_trigger_revision_before_update BEFORE UPDATE ON "RunbookTrigger"
FOR EACH ROW EXECUTE FUNCTION fence_runbook_trigger_revision();

CREATE FUNCTION touch_service_runbook_rule_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "ServiceRunbookBinding" SET "updatedAt" = CURRENT_TIMESTAMP,
      enabled = CASE WHEN mode = 'AUTOMATIC' THEN false ELSE enabled END WHERE id = OLD."bindingId";
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."bindingId" IS DISTINCT FROM OLD."bindingId") THEN
    UPDATE "ServiceRunbookBinding" SET "updatedAt" = CURRENT_TIMESTAMP,
      enabled = CASE WHEN mode = 'AUTOMATIC' THEN false ELSE enabled END WHERE id = NEW."bindingId";
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER runbook_trigger_configuration_after_write AFTER INSERT OR UPDATE OR DELETE ON "RunbookTrigger"
FOR EACH ROW EXECUTE FUNCTION touch_service_runbook_rule_configuration();

CREATE FUNCTION touch_runbook_trigger_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "RunbookTrigger" SET "updatedAt" = CURRENT_TIMESTAMP WHERE id = OLD."triggerId";
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."triggerId" IS DISTINCT FROM OLD."triggerId") THEN
    UPDATE "RunbookTrigger" SET "updatedAt" = CURRENT_TIMESTAMP WHERE id = NEW."triggerId";
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER runbook_trigger_condition_configuration_after_write AFTER INSERT OR UPDATE OR DELETE ON "RunbookTriggerCondition"
FOR EACH ROW EXECUTE FUNCTION touch_runbook_trigger_configuration();

CREATE INDEX "RunbookPolicyCheck_ruleId_createdAt_id_idx" ON "RunbookPolicyCheck" ("ruleId", "createdAt", id);
