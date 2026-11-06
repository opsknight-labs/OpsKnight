-- Round 6: who made each MCP call, how long the call log is kept, and two stricter policy options.
-- Additive only. The call log is a hot table, so the new columns are nullable (no rewrite, no
-- backfill: rows written before this migration simply have no client or user).
ALTER TABLE "McpCallLog" ADD COLUMN "clientId" TEXT;
ALTER TABLE "McpCallLog" ADD COLUMN "userId" TEXT;
CREATE INDEX "McpCallLog_clientId_at_idx" ON "McpCallLog"("clientId", "at" DESC);
CREATE INDEX "McpCallLog_userId_at_idx" ON "McpCallLog"("userId", "at" DESC);

ALTER TABLE "McpPolicy" ADD COLUMN "callLogRetentionDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "McpPolicy" ADD CONSTRAINT "McpPolicy_callLogRetentionDays_check"
  CHECK ("callLogRetentionDays" BETWEEN 7 AND 365);

-- Strict four-eyes: when on, nobody (including an administrator) approves their own change.
ALTER TABLE "McpPolicy" ADD COLUMN "requireDistinctReviewer" BOOLEAN NOT NULL DEFAULT false;

-- Optional cap on one person's requests per minute across all their connections; null is off.
ALTER TABLE "McpPolicy" ADD COLUMN "perUserRequestsPerMinute" INTEGER;
ALTER TABLE "McpPolicy" ADD CONSTRAINT "McpPolicy_perUserRequestsPerMinute_check"
  CHECK ("perUserRequestsPerMinute" IS NULL OR "perUserRequestsPerMinute" BETWEEN 1 AND 6000);
