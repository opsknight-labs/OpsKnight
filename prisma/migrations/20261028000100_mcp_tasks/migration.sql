-- Additive: durable MCP Tasks extension records bound to the requesting grant.
CREATE TABLE "McpTask" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "McpTask_grantId_createdAt_idx" ON "McpTask"("grantId", "createdAt");
CREATE INDEX "McpTask_expiresAt_idx" ON "McpTask"("expiresAt");

ALTER TABLE "McpTask" ADD CONSTRAINT "mcp_task_kind" CHECK ("kind" IN ('RUNBOOK_EXECUTION'));
