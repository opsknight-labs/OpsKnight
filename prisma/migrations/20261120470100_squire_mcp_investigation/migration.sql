-- Squire investigations started over MCP: a start/poll handle instead of one 30-second call.
CREATE TABLE "SquireMcpInvestigation" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "payloadEncrypted" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquireMcpInvestigation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SquireMcpInvestigation_actorId_status_createdAt_idx" ON "SquireMcpInvestigation"("actorId", "status", "createdAt");

CREATE INDEX "SquireMcpInvestigation_expiresAt_idx" ON "SquireMcpInvestigation"("expiresAt");
