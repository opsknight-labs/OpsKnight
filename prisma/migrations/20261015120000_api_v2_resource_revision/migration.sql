-- Monotonic revision for REST v2 ETags / If-Match.
--
-- A dedicated counter replaces timestamp-derived validators: it cannot repeat when two writes land
-- in the same millisecond, and the trigger makes every UPDATE advance it, whichever code path (REST,
-- UI, workers) performs the write. Adding a column with a constant default is a metadata-only change
-- on PostgreSQL 11+, so no table rewrite and only a brief ACCESS EXCLUSIVE lock.

CREATE OR REPLACE FUNCTION "bump_resource_revision"() RETURNS trigger AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "Team" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Service" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "EscalationPolicy" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Integration" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OnCallSchedule" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER "Team_bump_revision" BEFORE UPDATE ON "Team"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
CREATE TRIGGER "Service_bump_revision" BEFORE UPDATE ON "Service"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
CREATE TRIGGER "EscalationPolicy_bump_revision" BEFORE UPDATE ON "EscalationPolicy"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
CREATE TRIGGER "Integration_bump_revision" BEFORE UPDATE ON "Integration"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
CREATE TRIGGER "OnCallSchedule_bump_revision" BEFORE UPDATE ON "OnCallSchedule"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
