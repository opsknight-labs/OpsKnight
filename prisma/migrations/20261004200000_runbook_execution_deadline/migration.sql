-- Snapshot the definition-level execution timeout so every worker, wait,
-- HTTP request, Agent claim, and reconciliation pass shares one hard deadline.
ALTER TABLE "RunbookExecution"
  ADD COLUMN "timeoutSeconds" INTEGER NOT NULL DEFAULT 3600,
  ADD COLUMN "deadlineAt" TIMESTAMP(3);

UPDATE "RunbookExecution"
SET "deadlineAt" = COALESCE("startedAt", "createdAt") + ("timeoutSeconds" * INTERVAL '1 second');

ALTER TABLE "RunbookExecution" ALTER COLUMN "deadlineAt" SET NOT NULL;
CREATE INDEX "RunbookExecution_status_deadlineAt_idx" ON "RunbookExecution"("status", "deadlineAt");
CREATE INDEX "RunbookArtifact_createdAt_idx" ON "RunbookArtifact"("createdAt");
