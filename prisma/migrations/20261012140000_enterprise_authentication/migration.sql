-- AlterEnum
ALTER TYPE "InAppNotificationType" ADD VALUE 'SECURITY';

-- AlterTable
ALTER TABLE "AuthenticationPolicy" ADD COLUMN     "activeRevisionId" TEXT;

-- CreateTable
CREATE TABLE "EmergencyAccount" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENROLLING',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "verifiedCredentialVersion" INTEGER,
    "independenceConfirmedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyCredential" (
    "id" TEXT NOT NULL,
    "emergencyAccountId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "EmergencyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencySession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "emergencyAccountId" TEXT,
    "legacyUserId" TEXT,
    "credentialVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "EmergencySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "emergencyAccountId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "authorizedBy" TEXT,
    "sessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAccessEvent" (
    "id" TEXT NOT NULL,
    "emergencyAccountId" TEXT,
    "eventType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticationAlert" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "AuthenticationAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidcRevision" (
    "id" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "baseConfigVersion" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discoveryVerifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "previousRevisionId" TEXT,

    CONSTRAINT "OidcRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidcRevisionTest" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "adminTokenVersion" INTEGER NOT NULL,
    "testedConfigVersion" INTEGER NOT NULL DEFAULT 0,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "effectiveRole" TEXT NOT NULL,
    "linkApproved" BOOLEAN NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OidcRevisionTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidcTestFlow" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "adminTokenVersion" INTEGER NOT NULL,
    "testedConfigVersion" INTEGER NOT NULL DEFAULT 0,
    "authorizedBy" TEXT NOT NULL,
    "linkApproved" BOOLEAN NOT NULL,
    "secrets" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OidcTestFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticationReplicaObservation" (
    "id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "differs" BOOLEAN NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthenticationReplicaObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyCredential_credentialId_key" ON "EmergencyCredential"("credentialId");

-- CreateIndex
CREATE INDEX "EmergencyCredential_emergencyAccountId_revokedAt_idx" ON "EmergencyCredential"("emergencyAccountId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencySession_tokenHash_key" ON "EmergencySession"("tokenHash");

-- CreateIndex
CREATE INDEX "EmergencySession_emergencyAccountId_revokedAt_idx" ON "EmergencySession"("emergencyAccountId", "revokedAt");

-- CreateIndex
CREATE INDEX "EmergencySession_expiresAt_idx" ON "EmergencySession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyChallenge_challenge_key" ON "EmergencyChallenge"("challenge");

-- CreateIndex
CREATE INDEX "EmergencyChallenge_expiresAt_idx" ON "EmergencyChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "EmergencyAccessEvent_createdAt_idx" ON "EmergencyAccessEvent"("createdAt");

-- CreateIndex
CREATE INDEX "EmergencyAccessEvent_emergencyAccountId_createdAt_idx" ON "EmergencyAccessEvent"("emergencyAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthenticationAlert_deliveredAt_nextAttemptAt_idx" ON "AuthenticationAlert"("deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthenticationAlert_eventId_recipientId_key" ON "AuthenticationAlert"("eventId", "recipientId");

-- CreateIndex
CREATE INDEX "OidcRevisionTest_revisionId_verifiedAt_idx" ON "OidcRevisionTest"("revisionId", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OidcTestFlow_stateHash_key" ON "OidcTestFlow"("stateHash");

-- CreateIndex
CREATE INDEX "OidcTestFlow_expiresAt_idx" ON "OidcTestFlow"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmergencyCredential" ADD CONSTRAINT "EmergencyCredential_emergencyAccountId_fkey" FOREIGN KEY ("emergencyAccountId") REFERENCES "EmergencyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencySession" ADD CONSTRAINT "EmergencySession_emergencyAccountId_fkey" FOREIGN KEY ("emergencyAccountId") REFERENCES "EmergencyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OidcRevisionTest" ADD CONSTRAINT "OidcRevisionTest_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "OidcRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reject ambiguous principals and corrupt security state at the storage boundary.
ALTER TABLE "EmergencyAccount" ADD CONSTRAINT "EmergencyAccount_status_check" CHECK ("status" IN ('ENROLLING', 'ACTIVE', 'DISABLED'));
ALTER TABLE "EmergencyAccount" ADD CONSTRAINT "EmergencyAccount_version_check" CHECK ("credentialVersion" > 0 AND ("verifiedCredentialVersion" IS NULL OR "verifiedCredentialVersion" <= "credentialVersion"));
ALTER TABLE "EmergencySession" ADD CONSTRAINT "EmergencySession_principal_check" CHECK (("emergencyAccountId" IS NOT NULL) <> ("legacyUserId" IS NOT NULL));
ALTER TABLE "EmergencySession" ADD CONSTRAINT "EmergencySession_expiry_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '1 hour');
ALTER TABLE "EmergencyCredential" ADD CONSTRAINT "EmergencyCredential_counter_check" CHECK ("counter" >= 0 AND "counter" <= 4294967295);
ALTER TABLE "EmergencyChallenge" ADD CONSTRAINT "EmergencyChallenge_kind_check" CHECK ("kind" IN ('REGISTER', 'LOGIN', 'REAUTH'));
