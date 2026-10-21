-- Every writer, including existing UI instances and the global OFF command,
-- advances the same validator. A timestamp is not a safe concurrency token.
ALTER TABLE "ServiceAutomationConfig" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION automation_config_revision_increment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_config_revision_increment
BEFORE UPDATE ON "ServiceAutomationConfig"
FOR EACH ROW EXECUTE FUNCTION automation_config_revision_increment();
