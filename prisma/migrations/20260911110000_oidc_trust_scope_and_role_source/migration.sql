CREATE TYPE "RoleSource" AS ENUM ('MANUAL', 'OIDC', 'SCIM');

ALTER TABLE "User"
ADD COLUMN "roleSource" "RoleSource" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "OidcConfig"
ADD COLUMN "configVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "OidcIdentity"
ADD COLUMN "providerConfigId" TEXT DEFAULT 'default',
ADD COLUMN "providerObjectId" TEXT,
ADD COLUMN "tenantId" TEXT,
ADD COLUMN "emailAtLink" TEXT,
ADD COLUMN "lastLoginAt" TIMESTAMP(3);

UPDATE "OidcIdentity" SET "emailAtLink" = "email" WHERE "emailAtLink" IS NULL;

ALTER TABLE "OidcLinkingApproval"
ADD COLUMN "consumedAt" TIMESTAMP(3),
ADD COLUMN "providerConfigId" TEXT DEFAULT 'default',
ADD COLUMN "issuerFingerprint" TEXT,
ADD COLUMN "expectedEmail" TEXT,
ADD COLUMN "configVersion" INTEGER;

CREATE INDEX "OidcIdentity_providerConfigId_idx" ON "OidcIdentity"("providerConfigId");
