ALTER TABLE "ChatOpsConfig" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER "ChatOpsConfig_bump_revision" BEFORE UPDATE ON "ChatOpsConfig"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
