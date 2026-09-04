-- Durable Slack ChatOps inbox. Domain effects and response delivery have
-- separate states, so an HTTP acknowledgement or Slack response retry cannot
-- lose or repeat an incident mutation.
CREATE TYPE "ChatOpsIntentKind" AS ENUM ('SLASH_COMMAND', 'INTERACTIVE_ACTION');
CREATE TYPE "ChatOpsIntentStatus" AS ENUM ('PENDING', 'PROCESSING', 'EFFECT_COMPLETED', 'COMPLETED', 'FAILED');

CREATE TABLE "ChatOpsIntent" (
  "id" TEXT NOT NULL,
  "kind" "ChatOpsIntentKind" NOT NULL,
  "deliveryHash" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT,
  "slackUserId" TEXT,
  "encryptedPayload" TEXT NOT NULL,
  "status" "ChatOpsIntentStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "effectCompletedAt" TIMESTAMP(3),
  "responseCompletedAt" TIMESTAMP(3),
  "responsePayload" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatOpsIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatOpsIntent_kind_deliveryHash_key" ON "ChatOpsIntent"("kind", "deliveryHash");
CREATE INDEX "ChatOpsIntent_status_leaseExpiresAt_idx" ON "ChatOpsIntent"("status", "leaseExpiresAt");
CREATE INDEX "ChatOpsIntent_workspaceId_channelId_idx" ON "ChatOpsIntent"("workspaceId", "channelId");

ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CHATOPS_INTENT';
