ALTER TABLE "Runbook" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION increment_runbook_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runbook_revision_before_update BEFORE UPDATE ON "Runbook"
FOR EACH ROW EXECUTE FUNCTION increment_runbook_revision();
