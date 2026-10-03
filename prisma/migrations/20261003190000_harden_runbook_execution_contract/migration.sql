-- Execution snapshots make each run deterministic even after bindings change.
ALTER TABLE "RunbookExecution"
  ADD COLUMN "inputValues" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "definitionChecksum" TEXT NOT NULL;

-- Store the resolved step plan and exact approval fence on the execution row.
ALTER TABLE "RunbookExecutionStep"
  ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "timeoutSeconds" INTEGER,
  ADD COLUMN "maxRetries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approvedPlanDigest" TEXT,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3);

ALTER TABLE "RunbookStepAttempt"
  ADD COLUMN "preState" JSONB,
  ADD COLUMN "postState" JSONB;

ALTER TABLE "RunbookAgent"
  ADD COLUMN "enrollmentExpiresAt" TIMESTAMP(3);

CREATE INDEX "RunbookExecutionStep_approvedById_idx"
  ON "RunbookExecutionStep"("approvedById")
  WHERE "approvedById" IS NOT NULL;

ALTER TABLE "RunbookExecutionStep"
  ADD CONSTRAINT "RunbookExecutionStep_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
