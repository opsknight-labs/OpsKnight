-- A dashboard ETag must advance on UI and REST edits, including widget replacements.
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'DASHBOARD';
ALTER TABLE "Dashboard" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER "Dashboard_bump_revision" BEFORE UPDATE ON "Dashboard"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
