-- Additive: durable, independently reviewed approvals for sensitive MCP operations.
CREATE TABLE "McpOperationApproval" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL,
    "operationDigest" TEXT NOT NULL,
    "contractDigest" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requesterGrantId" TEXT NOT NULL,
    "requesterCredentialId" TEXT NOT NULL,
    "envelope" TEXT,
    "summary" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewerTokenVersion" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "executingAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "outcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOperationApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "McpOperationApproval_requesterGrantId_createdAt_idx"
  ON "McpOperationApproval"("requesterGrantId", "createdAt");
CREATE INDEX "McpOperationApproval_status_expiresAt_idx"
  ON "McpOperationApproval"("status", "expiresAt");

ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_status"
CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'COMMITTED', 'FAILED'));

-- A requester can never review their own request; approval records its reviewer and time.
ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_distinct_reviewer"
CHECK ("reviewedById" IS NULL OR
  ("reviewedById" <> "actorId" AND "reviewedAt" IS NOT NULL AND "reviewerTokenVersion" IS NOT NULL
   AND "rejectedAt" IS NULL));

ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_state"
CHECK (
  ("status" = 'PENDING' AND "reviewedAt" IS NULL AND "rejectedAt" IS NULL) OR
  ("status" = 'REJECTED' AND "rejectedAt" IS NOT NULL) OR
  ("status" IN ('APPROVED', 'EXECUTING', 'COMMITTED', 'FAILED') AND "reviewedAt" IS NOT NULL)
);
