-- CreateTable
CREATE TABLE "ScimConnector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GENERIC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credentialAuthority" TEXT NOT NULL DEFAULT 'REGISTRY',
    "tenantId" TEXT,
    "oidcIssuer" TEXT,
    "oidcClientId" TEXT,
    "trustedLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimCredential" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "scopes" TEXT[],
    "generation" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ScimCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimIdentity" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimGroup" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scimExternalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimGroupMembership" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ScimGroupMembership_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "ScimGroupTeamBinding" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimGroupTeamBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimTeamGrant" (
    "bindingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,

    CONSTRAINT "ScimTeamGrant_pkey" PRIMARY KEY ("bindingId","userId")
);

-- CreateTable
CREATE TABLE "ScimEvent" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "requestId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScimCredential_tokenHash_key" ON "ScimCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "ScimCredential_connectorId_revokedAt_expiresAt_idx" ON "ScimCredential"("connectorId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScimIdentity_userId_key" ON "ScimIdentity"("userId");

-- CreateIndex
CREATE INDEX "ScimIdentity_connectorId_deletedAt_userId_idx" ON "ScimIdentity"("connectorId", "deletedAt", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimIdentity_connectorId_externalId_key" ON "ScimIdentity"("connectorId", "externalId");

-- CreateIndex
CREATE INDEX "ScimGroup_connectorId_name_id_idx" ON "ScimGroup"("connectorId", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroup_connectorId_scimExternalId_key" ON "ScimGroup"("connectorId", "scimExternalId");

-- CreateIndex
CREATE INDEX "ScimGroupMembership_userId_idx" ON "ScimGroupMembership"("userId");

-- CreateIndex
CREATE INDEX "ScimGroupTeamBinding_teamId_idx" ON "ScimGroupTeamBinding"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroupTeamBinding_groupId_teamId_key" ON "ScimGroupTeamBinding"("groupId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimTeamGrant_teamMemberId_key" ON "ScimTeamGrant"("teamMemberId");

-- CreateIndex
CREATE INDEX "ScimEvent_connectorId_createdAt_id_idx" ON "ScimEvent"("connectorId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ScimCredential" ADD CONSTRAINT "ScimCredential_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ScimConnector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimIdentity" ADD CONSTRAINT "ScimIdentity_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ScimConnector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimIdentity" ADD CONSTRAINT "ScimIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroup" ADD CONSTRAINT "ScimGroup_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ScimConnector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMembership" ADD CONSTRAINT "ScimGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMembership" ADD CONSTRAINT "ScimGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupTeamBinding" ADD CONSTRAINT "ScimGroupTeamBinding_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupTeamBinding" ADD CONSTRAINT "ScimGroupTeamBinding_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimTeamGrant" ADD CONSTRAINT "ScimTeamGrant_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ScimGroupTeamBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimEvent" ADD CONSTRAINT "ScimEvent_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ScimConnector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve the legacy directory namespace. No operational team is automatically bound.
INSERT INTO "ScimConnector" ("id", "name", "credentialAuthority", "updatedAt")
VALUES ('legacy', 'Existing SCIM connection', 'LEGACY', CURRENT_TIMESTAMP);
INSERT INTO "ScimIdentity" ("id", "connectorId", "externalId", "userId")
SELECT 'legacy:' || "id", 'legacy', "scimExternalId", "id" FROM "User" WHERE "scimExternalId" IS NOT NULL;
INSERT INTO "ScimGroup" ("id", "connectorId", "name", "scimExternalId", "createdAt", "updatedAt")
SELECT "id", 'legacy', "name", "scimExternalId", "createdAt", "updatedAt" FROM "Team" WHERE "scimExternalId" IS NOT NULL;
INSERT INTO "ScimGroupMembership" ("groupId", "userId")
SELECT m."teamId", m."userId" FROM "TeamMember" m JOIN "ScimGroup" g ON g."id" = m."teamId"
JOIN "ScimIdentity" i ON i."userId" = m."userId";
ALTER TABLE "User" ADD COLUMN "scimGivenName" TEXT, ADD COLUMN "scimFamilyName" TEXT;
