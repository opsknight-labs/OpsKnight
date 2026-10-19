BEGIN;
ALTER TABLE "TeamMember" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Every writer, including SCIM and older application versions, invalidates the
-- parent ETag and conflicts with stale Serializable administrative snapshots.
CREATE FUNCTION opsknight_team_membership_revision() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    UPDATE "Team" SET revision = revision WHERE id = OLD."teamId";
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."teamId" IS DISTINCT FROM OLD."teamId") THEN
    UPDATE "Team" SET revision = revision WHERE id = NEW."teamId";
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TeamMember_parent_revision"
AFTER INSERT OR UPDATE OR DELETE ON "TeamMember"
FOR EACH ROW EXECUTE FUNCTION opsknight_team_membership_revision();
COMMIT;
