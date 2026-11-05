-- Additive: nothing is dropped. "McpGrant"."userTokenVersion" is kept for one release.

-- MCP connections pin a revocation version that moves only on security events, so team and role
-- edits (which bump tokenVersion) no longer sign assistants out. Backfill both sides from the
-- current values so every grant that authenticates today still authenticates after the upgrade,
-- and every grant already invalidated by a tokenVersion bump stays invalid.
ALTER TABLE "User" ADD COLUMN "mcpRevocationVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "User" SET "mcpRevocationVersion" = "tokenVersion" WHERE "mcpRevocationVersion" <> "tokenVersion";

ALTER TABLE "McpGrant" ADD COLUMN "userRevocationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastCallAt" TIMESTAMP(3),
  ADD COLUMN "lastTool" TEXT;
UPDATE "McpGrant" SET "userRevocationVersion" = "userTokenVersion"
WHERE "userRevocationVersion" <> "userTokenVersion";

-- Refresh reuse grace: link a rotated token to its successor and record access-token use.
ALTER TABLE "McpToken" ADD COLUMN "successorId" TEXT,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3);

ALTER TABLE "McpPolicy" ADD COLUMN "approvalTtlMinutes" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN "approvalCommitWindowMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "refreshReuseGraceSeconds" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "policyRevision" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "McpPolicy_approvalTtlMinutes_check" CHECK ("approvalTtlMinutes" BETWEEN 15 AND 1440),
  ADD CONSTRAINT "McpPolicy_approvalCommitWindowMinutes_check"
    CHECK ("approvalCommitWindowMinutes" BETWEEN 1 AND 1440),
  ADD CONSTRAINT "McpPolicy_refreshReuseGraceSeconds_check"
    CHECK ("refreshReuseGraceSeconds" BETWEEN 0 AND 300),
  ADD CONSTRAINT "McpPolicy_policyRevision_check" CHECK ("policyRevision" >= 0);

-- Rejections record who rejected and an optional reason; approval sets a commit deadline.
-- rejectedById is separate from reviewedById, which always means approval authority.
ALTER TABLE "McpOperationApproval" ADD COLUMN "rejectedById" TEXT,
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "commitDeadline" TIMESTAMP(3),
  ADD CONSTRAINT "mcp_operation_approval_decision_reason_length"
    CHECK ("decisionReason" IS NULL OR char_length("decisionReason") <= 500),
  ADD CONSTRAINT "mcp_operation_approval_rejected_by"
    CHECK ("rejectedById" IS NULL OR "rejectedAt" IS NOT NULL);

ALTER TABLE "RunbookPreviewAuthorization" ADD COLUMN "rejectedById" TEXT,
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "commitDeadline" TIMESTAMP(3),
  ADD CONSTRAINT "runbook_preview_decision_reason_length"
    CHECK ("decisionReason" IS NULL OR char_length("decisionReason") <= 500),
  ADD CONSTRAINT "runbook_preview_rejected_by"
    CHECK ("rejectedById" IS NULL OR "rejectedAt" IS NOT NULL);

-- The retention sweep marks lapsed approvals EXPIRED. Widen the status checks to allow it; an
-- expired approval may or may not have been reviewed first.
ALTER TABLE "McpOperationApproval" DROP CONSTRAINT IF EXISTS "mcp_operation_approval_status";
ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_status"
CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'COMMITTED', 'FAILED', 'EXPIRED'));

ALTER TABLE "McpOperationApproval" DROP CONSTRAINT IF EXISTS "mcp_operation_approval_state";
ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_state"
CHECK (
  ("status" = 'PENDING' AND "reviewedAt" IS NULL AND "rejectedAt" IS NULL) OR
  ("status" = 'REJECTED' AND "rejectedAt" IS NOT NULL) OR
  ("status" IN ('APPROVED', 'EXECUTING', 'COMMITTED', 'FAILED') AND "reviewedAt" IS NOT NULL) OR
  ("status" = 'EXPIRED' AND "rejectedAt" IS NULL)
);

-- OAuth makes state optional; PKCE stays mandatory.
ALTER TABLE "McpConsentRequest" ALTER COLUMN "state" DROP NOT NULL;

-- Foreign-key lookups used by revocation, retention and the connections list.
CREATE INDEX IF NOT EXISTS "McpToken_grantId_idx" ON "McpToken"("grantId");
CREATE INDEX IF NOT EXISTS "McpAuthorizationCode_grantId_idx" ON "McpAuthorizationCode"("grantId");
CREATE INDEX IF NOT EXISTS "McpGrant_clientId_idx" ON "McpGrant"("clientId");
