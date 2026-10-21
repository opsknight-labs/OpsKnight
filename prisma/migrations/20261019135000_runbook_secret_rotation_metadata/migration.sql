-- Existing values have unknown historical rotation times; do not invent one.
ALTER TABLE "RunbookSecret" ADD COLUMN "lastRotatedAt" TIMESTAMP(3);
ALTER TABLE "RunbookSecret" ALTER COLUMN "lastRotatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE FUNCTION public.opsknight_runbook_secret_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  IF NEW."valueEncrypted" IS DISTINCT FROM OLD."valueEncrypted" THEN
    NEW."lastRotatedAt" := CURRENT_TIMESTAMP;
  ELSE
    NEW."lastRotatedAt" := OLD."lastRotatedAt";
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER "RunbookSecret_configuration_revision" ON "RunbookSecret";
CREATE TRIGGER "RunbookSecret_configuration_revision" BEFORE UPDATE ON "RunbookSecret"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_secret_revision();
