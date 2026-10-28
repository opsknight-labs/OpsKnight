-- CreateTable
CREATE TABLE "McpPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "writesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxInFlight" INTEGER NOT NULL DEFAULT 4,
    "maxOperations" INTEGER NOT NULL DEFAULT 8,
    "requestsPerMinute" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "scopes" TEXT[],
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpGrant" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userTokenVersion" INTEGER NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpAuthorizationCode" (
    "hash" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "McpAuthorizationCode_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "McpToken" (
    "id" TEXT NOT NULL,
    "accessHash" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "scopes" TEXT[],
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpConsentRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scopes" TEXT[],
    "challenge" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "McpConsentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McpGrant_userId_createdAt_id_idx" ON "McpGrant"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "McpGrant_expiresAt_idx" ON "McpGrant"("expiresAt");

-- CreateIndex
CREATE INDEX "McpAuthorizationCode_expiresAt_idx" ON "McpAuthorizationCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpToken_accessHash_key" ON "McpToken"("accessHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpToken_refreshHash_key" ON "McpToken"("refreshHash");

-- CreateIndex
CREATE INDEX "McpToken_refreshExpiresAt_idx" ON "McpToken"("refreshExpiresAt");

-- CreateIndex
CREATE INDEX "McpConsentRequest_expiresAt_idx" ON "McpConsentRequest"("expiresAt");

-- AddForeignKey
ALTER TABLE "McpGrant" ADD CONSTRAINT "McpGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpAuthorizationCode" ADD CONSTRAINT "McpAuthorizationCode_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "McpGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "McpGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
