-- Configuration revisions exclude Agent heartbeat churn and unrelated workspace settings.
ALTER TABLE "RunbookAgent" ADD COLUMN "configurationRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RunbookAgentPool" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RunbookSecret" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
-- Zero represents an absent settings row in the read contract; persisted rows start at one.
ALTER TABLE "SystemSettings" ADD COLUMN "runbookSettingsRevision" INTEGER NOT NULL DEFAULT 1;

CREATE FUNCTION public.opsknight_runbook_agent_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.labels IS DISTINCT FROM OLD.labels
     OR NEW."publicKey" IS DISTINCT FROM OLD."publicKey"
     OR (NEW.status = 'REVOKED') IS DISTINCT FROM (OLD.status = 'REVOKED') THEN
    NEW."configurationRevision" := OLD."configurationRevision" + 1;
  ELSE
    NEW."configurationRevision" := OLD."configurationRevision";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RunbookAgent_configuration_revision" BEFORE UPDATE ON "RunbookAgent"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_agent_revision();

CREATE FUNCTION public.opsknight_runbook_admin_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RunbookAgentPool_configuration_revision" BEFORE UPDATE ON "RunbookAgentPool"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_admin_revision();
CREATE TRIGGER "RunbookSecret_configuration_revision" BEFORE UPDATE ON "RunbookSecret"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_admin_revision();

CREATE FUNCTION public.opsknight_runbook_pool_membership_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public."RunbookAgentPool" SET revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = NEW."poolId";
  ELSE
    UPDATE public."RunbookAgentPool" SET revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = OLD."poolId";
    IF TG_OP = 'UPDATE' THEN
      IF NEW."poolId" IS DISTINCT FROM OLD."poolId" THEN
        UPDATE public."RunbookAgentPool" SET revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = NEW."poolId";
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "RunbookAgentPoolMember_parent_revision" AFTER INSERT OR UPDATE OR DELETE ON "RunbookAgentPoolMember"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_pool_membership_revision();

CREATE FUNCTION public.opsknight_runbook_secret_grant_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public."RunbookSecret" SET revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = NEW."secretId";
  ELSE
    UPDATE public."RunbookSecret" SET revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = OLD."secretId";
    IF TG_OP = 'UPDATE' THEN
      IF NEW."secretId" IS DISTINCT FROM OLD."secretId" THEN
        UPDATE public."RunbookSecret" SET revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = NEW."secretId";
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "RunbookSecretGrant_parent_revision" AFTER INSERT OR UPDATE OR DELETE ON "RunbookSecretGrant"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_secret_grant_revision();

CREATE FUNCTION public.opsknight_runbook_settings_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."runbookArtifactRetentionDays" IS DISTINCT FROM OLD."runbookArtifactRetentionDays"
     OR NEW."runbookAutoExecutionsPerIncident" IS DISTINCT FROM OLD."runbookAutoExecutionsPerIncident"
     OR NEW."runbookAutoWritesPerIncident" IS DISTINCT FROM OLD."runbookAutoWritesPerIncident"
     OR NEW."runbookAutoNonIdempotentPerIncident" IS DISTINCT FROM OLD."runbookAutoNonIdempotentPerIncident" THEN
    NEW."runbookSettingsRevision" := OLD."runbookSettingsRevision" + 1;
  ELSE
    NEW."runbookSettingsRevision" := OLD."runbookSettingsRevision";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SystemSettings_runbook_configuration_revision" BEFORE UPDATE ON "SystemSettings"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_settings_revision();
CREATE INDEX "RunbookAgentPool_createdAt_id_idx" ON "RunbookAgentPool"("createdAt", "id");
CREATE INDEX "RunbookSecret_createdAt_id_idx" ON "RunbookSecret"("createdAt", "id");
