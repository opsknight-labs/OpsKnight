-- Team memberships created by single sign-on group rules. Like SCIM grants, only rows recorded
-- here may ever be removed by sign-in reconciliation; manual memberships are never touched.
CREATE TABLE "OidcTeamGrant" (
  "id" TEXT NOT NULL,
  "teamMemberId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OidcTeamGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OidcTeamGrant_teamMemberId_key" ON "OidcTeamGrant"("teamMemberId");
CREATE UNIQUE INDEX "OidcTeamGrant_userId_teamId_key" ON "OidcTeamGrant"("userId", "teamId");
CREATE INDEX "OidcTeamGrant_teamId_idx" ON "OidcTeamGrant"("teamId");
ALTER TABLE "OidcTeamGrant" ADD CONSTRAINT "OidcTeamGrant_teamMemberId_fkey"
  FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An administrator changing a granted member's team role makes the membership theirs.
CREATE FUNCTION oidc_release_manual_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role" THEN
    DELETE FROM "OidcTeamGrant" WHERE "teamMemberId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TeamMember_oidc_release_manual_membership"
AFTER UPDATE OF "role" ON "TeamMember"
FOR EACH ROW EXECUTE FUNCTION oidc_release_manual_membership();
