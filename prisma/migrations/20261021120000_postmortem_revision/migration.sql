-- Every UI, REST and worker parent-row update advances the same strong validator.
ALTER TABLE "Postmortem" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER "Postmortem_bump_revision" BEFORE UPDATE ON "Postmortem"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
