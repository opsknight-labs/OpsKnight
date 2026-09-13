ALTER TABLE "MicrosoftTeamsConfig"
  ADD COLUMN "interactiveEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MicrosoftTeamsDestination"
  ADD COLUMN "interactiveEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MicrosoftTeamsIncidentMessage"
  ADD COLUMN "messageGeneration" INTEGER NOT NULL DEFAULT 1;

CREATE TYPE "ChatIdentityVerificationMethod" AS ENUM ('ACCOUNT_LINK', 'OIDC', 'ADMIN');

CREATE TABLE "ChatIdentityLink" (
  "id" TEXT NOT NULL,
  "provider" "ChatProvider" NOT NULL,
  "providerTenantId" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "providerObjectId" TEXT,
  "userId" TEXT NOT NULL,
  "displayName" TEXT,
  "verificationMethod" "ChatIdentityVerificationMethod" NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatIdentityLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatIdentityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChatIdentityChallenge" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "provider" "ChatProvider" NOT NULL,
  "providerTenantId" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "providerObjectId" TEXT,
  "displayName" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatIdentityChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatIdentityLink_provider_providerTenantId_providerUserId_key" ON "ChatIdentityLink"("provider", "providerTenantId", "providerUserId");
CREATE UNIQUE INDEX "ChatIdentityLink_provider_providerTenantId_providerObjectId_key" ON "ChatIdentityLink"("provider", "providerTenantId", "providerObjectId");
CREATE INDEX "ChatIdentityLink_userId_provider_idx" ON "ChatIdentityLink"("userId", "provider");
CREATE INDEX "ChatIdentityLink_provider_providerTenantId_revokedAt_idx" ON "ChatIdentityLink"("provider", "providerTenantId", "revokedAt");
CREATE UNIQUE INDEX "ChatIdentityChallenge_tokenHash_key" ON "ChatIdentityChallenge"("tokenHash");
CREATE INDEX "ChatIdentityChallenge_expiresAt_idx" ON "ChatIdentityChallenge"("expiresAt");
CREATE INDEX "ChatIdentityChallenge_provider_providerTenantId_providerUserId_idx" ON "ChatIdentityChallenge"("provider", "providerTenantId", "providerUserId");

ALTER TABLE "ChatOpsIntent"
  ADD COLUMN "providerTenantId" TEXT,
  ADD COLUMN "providerConversationId" TEXT,
  ADD COLUMN "providerChannelId" TEXT,
  ADD COLUMN "providerActivityId" TEXT,
  ADD COLUMN "providerUserId" TEXT,
  ADD COLUMN "providerObjectId" TEXT;

CREATE INDEX "ChatOpsIntent_provider_providerTenantId_providerActivityId_idx"
  ON "ChatOpsIntent"("provider", "providerTenantId", "providerActivityId");
