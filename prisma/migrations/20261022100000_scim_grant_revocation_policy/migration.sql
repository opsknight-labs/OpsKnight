-- Notification preferences never establish an independent authorization grant.
-- Only an actual local role change releases directory membership provenance.
CREATE OR REPLACE FUNCTION scim_release_manual_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role" THEN
    DELETE FROM "ScimTeamGrant" WHERE "teamMemberId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
