ALTER TABLE "CustomField" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER "CustomField_bump_revision" BEFORE UPDATE ON "CustomField"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
