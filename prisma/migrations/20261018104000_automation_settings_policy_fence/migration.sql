CREATE FUNCTION fence_automation_settings_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."automationReadinessPolicy" IS DISTINCT FROM OLD."automationReadinessPolicy"
    OR NEW."automationEnabled" IS DISTINCT FROM OLD."automationEnabled"
    OR NEW."automationStoreObservationPreviews" IS DISTINCT FROM OLD."automationStoreObservationPreviews"
    OR NEW."automationTraceRetentionDays" IS DISTINCT FROM OLD."automationTraceRetentionDays" THEN
    NEW."automationSettingsRevision" := OLD."automationSettingsRevision" + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_settings_revision_before_update BEFORE UPDATE ON "SystemSettings"
FOR EACH ROW EXECUTE FUNCTION fence_automation_settings_revision();
