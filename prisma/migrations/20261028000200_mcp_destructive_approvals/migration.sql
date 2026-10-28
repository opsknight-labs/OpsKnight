-- Additive: destructive (R3) approvals bind a fresh reviewer authentication and the reviewed target state.
ALTER TABLE "McpOperationApproval"
  ADD COLUMN "reviewerAuthenticatedAt" TIMESTAMP(3),
  ADD COLUMN "previewDigest" TEXT;

-- An approved destructive change always carries both.
ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_r3_binding"
CHECK ("riskClass" <> 'R3' OR "previewDigest" IS NOT NULL);
ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_r3_reauthentication"
CHECK ("riskClass" <> 'R3' OR "reviewedAt" IS NULL OR "reviewerAuthenticatedAt" IS NOT NULL);
