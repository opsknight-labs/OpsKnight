-- Ordered bounded retention scans and indexed ON DELETE SET NULL checks.
CREATE INDEX "RunbookArtifact_createdAt_id_idx" ON "RunbookArtifact"("createdAt", "id");
DROP INDEX "RunbookArtifact_createdAt_idx";
CREATE INDEX "RunbookStepAttempt_outputArtifactId_idx" ON "RunbookStepAttempt"("outputArtifactId");
