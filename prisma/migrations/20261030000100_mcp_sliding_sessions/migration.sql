ALTER TABLE "McpPolicy" ADD COLUMN "sessionIdleDays" INTEGER NOT NULL DEFAULT 30,
  ADD CONSTRAINT "McpPolicy_sessionIdleDays_check" CHECK ("sessionIdleDays" BETWEEN 1 AND 90);
ALTER TABLE "McpGrant" ADD COLUMN "absoluteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastUsedAt" TIMESTAMP(3);
