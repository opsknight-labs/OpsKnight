-- Restore the role authority that historical profile-only SCIM writes overwrote.
-- SCIM has never granted entitlements; a linked OIDC principal owns these prior claims.
UPDATE "User" u SET "roleSource" = 'OIDC'
WHERE u."roleSource" = 'SCIM' AND EXISTS (SELECT 1 FROM "OidcIdentity" i WHERE i."userId" = u.id);

ALTER TABLE "ScimTeamGrant" ADD CONSTRAINT "ScimTeamGrant_teamMemberId_fkey"
FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An explicit local membership edit establishes independent manual authority.
-- Directory reconciliation only inserts/removes its own rows, never updates them.
CREATE FUNCTION scim_release_manual_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "ScimTeamGrant" WHERE "teamMemberId" = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER scim_manual_membership_authority
AFTER UPDATE OF "role", "receiveTeamNotifications" ON "TeamMember"
FOR EACH ROW EXECUTE FUNCTION scim_release_manual_membership();
