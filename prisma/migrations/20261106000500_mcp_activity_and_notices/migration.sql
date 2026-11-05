-- Additive. Per-connection MCP activity log (bounded labels, 30-day retention), an index so a
-- decided approval can close its reviewer notices without scanning notifications, and an index
-- for the retention purge of finished approvals.
CREATE TABLE "McpCallLog" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tool" TEXT NOT NULL,
    "operationId" TEXT,
    "outcome" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "errorCode" TEXT,

    CONSTRAINT "McpCallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "McpCallLog_grantId_at_id_idx" ON "McpCallLog"("grantId", "at" DESC, "id" DESC);
CREATE INDEX "McpCallLog_at_idx" ON "McpCallLog"("at");

CREATE INDEX "InAppNotification_entityType_entityId_idx" ON "InAppNotification"("entityType", "entityId");

CREATE INDEX "McpOperationApproval_status_createdAt_idx" ON "McpOperationApproval"("status", "createdAt");
