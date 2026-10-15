-- Ordered bounded retention scans and indexed ON DELETE SET NULL checks.
CREATE INDEX IF NOT EXISTS "RunbookArtifact_createdAt_id_idx" ON "RunbookArtifact"("createdAt", "id");
DROP INDEX IF EXISTS "RunbookArtifact_createdAt_idx";
CREATE INDEX IF NOT EXISTS "RunbookStepAttempt_outputArtifactId_idx" ON "RunbookStepAttempt"("outputArtifactId");
