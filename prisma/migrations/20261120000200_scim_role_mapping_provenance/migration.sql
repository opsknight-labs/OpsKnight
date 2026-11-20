-- roleSource=SCIM existed before group role mapping. Preserve every existing role
-- and its OIDC takeover behavior until an approved mapping explicitly adopts it.
ALTER TABLE "User" ADD COLUMN "scimRoleMappingAdopted" BOOLEAN NOT NULL DEFAULT false;
