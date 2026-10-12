ALTER TABLE "AuthenticationPolicy"
  ADD COLUMN "passwordSessionMinVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "oidcSessionMinVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "AuthenticationPolicy_revocation_watermarks" CHECK
    ("passwordSessionMinVersion" >= 0 AND "oidcSessionMinVersion" >= 0);
-- Imported required policies must keep pre-migration password sessions revoked,
-- even when an administrator later returns to optional mode.
UPDATE "AuthenticationPolicy" SET "passwordSessionMinVersion" = "version" WHERE "mode" = 'SSO_REQUIRED';
