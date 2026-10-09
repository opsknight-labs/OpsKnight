-- Migration: 20261009120000_runbook_published_immutability
-- Enforces DB-level immutability for published and retired runbook versions and their inputs.

CREATE OR REPLACE FUNCTION opsknight_runbook_version_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."state" IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'Cannot delete % runbook version', OLD."state" USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."state" = 'RETIRED' THEN
      RAISE EXCEPTION 'Cannot mutate retired runbook version' USING ERRCODE = '23514';
    ELSIF OLD."state" = 'PUBLISHED' THEN
      -- The only permitted transition is PUBLISHED -> RETIRED, with definition and checksum preserved.
      IF NEW."state" = 'RETIRED'
        AND NEW."id" IS NOT DISTINCT FROM OLD."id"
        AND NEW."runbookId" IS NOT DISTINCT FROM OLD."runbookId"
        AND NEW."version" IS NOT DISTINCT FROM OLD."version"
        AND NEW."definition" IS NOT DISTINCT FROM OLD."definition"
        AND NEW."schemaVersion" IS NOT DISTINCT FROM OLD."schemaVersion"
        AND NEW."checksum" IS NOT DISTINCT FROM OLD."checksum"
        AND NEW."draftRevision" IS NOT DISTINCT FROM OLD."draftRevision"
        AND NEW."createdById" IS NOT DISTINCT FROM OLD."createdById"
        AND NEW."publishedById" IS NOT DISTINCT FROM OLD."publishedById"
        AND NEW."publishedAt" IS NOT DISTINCT FROM OLD."publishedAt"
        AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt" THEN
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'Published runbook versions are immutable and can only transition to RETIRED' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_runbook_version_immutability ON "RunbookVersion";
CREATE TRIGGER trg_runbook_version_immutability
  BEFORE UPDATE OR DELETE ON "RunbookVersion"
  FOR EACH ROW
  EXECUTE FUNCTION opsknight_runbook_version_immutability();

CREATE OR REPLACE FUNCTION opsknight_runbook_input_immutability() RETURNS TRIGGER AS $$
DECLARE
  v_version_id TEXT;
  v_version_state "RunbookVersionState";
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_version_id := OLD."runbookVersionId";
  ELSE
    v_version_id := NEW."runbookVersionId";
  END IF;

  SELECT "state" INTO v_version_state
  FROM "RunbookVersion"
  WHERE "id" = v_version_id;

  IF v_version_state IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'Cannot mutate inputs for % runbook version', v_version_state USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."runbookVersionId" IS DISTINCT FROM NEW."runbookVersionId" THEN
    SELECT "state" INTO v_version_state
    FROM "RunbookVersion"
    WHERE "id" = OLD."runbookVersionId";

    IF v_version_state IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'Cannot move inputs away from % runbook version', v_version_state USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_runbook_input_immutability ON "RunbookInput";
CREATE TRIGGER trg_runbook_input_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON "RunbookInput"
  FOR EACH ROW
  EXECUTE FUNCTION opsknight_runbook_input_immutability();
