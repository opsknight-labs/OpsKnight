-- Additive. OAuth 2.0 device authorization grant (RFC 8628) for CLIs, SSH sessions and headless
-- servers. Off until an administrator turns it on, and then only for clients registered for it.
ALTER TABLE "McpPolicy" ADD COLUMN "deviceFlowEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "McpClient" ADD COLUMN "deviceCodeGrant" BOOLEAN NOT NULL DEFAULT false;

-- One device sign-in. Only HMAC digests of the device code and the user code are stored.
CREATE TABLE "McpDeviceAuthorization" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "requestedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "grantId" TEXT,
    "approvedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interval" INTEGER NOT NULL DEFAULT 5,
    "lastPolledAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpDeviceAuthorization_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "McpDeviceAuthorization_status_check"
      CHECK ("status" IN ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED', 'EXPIRED')),
    CONSTRAINT "McpDeviceAuthorization_interval_check" CHECK ("interval" BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX "McpDeviceAuthorization_deviceCodeHash_key" ON "McpDeviceAuthorization"("deviceCodeHash");
CREATE UNIQUE INDEX "McpDeviceAuthorization_userCodeHash_key" ON "McpDeviceAuthorization"("userCodeHash");
CREATE INDEX "McpDeviceAuthorization_expiresAt_idx" ON "McpDeviceAuthorization"("expiresAt");
CREATE INDEX "McpDeviceAuthorization_clientId_status_idx" ON "McpDeviceAuthorization"("clientId", "status");

ALTER TABLE "McpDeviceAuthorization" ADD CONSTRAINT "McpDeviceAuthorization_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "McpClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
