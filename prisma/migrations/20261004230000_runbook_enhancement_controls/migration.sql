ALTER TABLE "SystemSettings" ADD COLUMN "runbookAutoExecutionsPerIncident" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "runbookAutoWritesPerIncident" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "runbookAutoNonIdempotentPerIncident" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SystemSettings" ADD CONSTRAINT "runbook_budget_nonnegative" CHECK (
  "runbookAutoExecutionsPerIncident" >= 0 AND "runbookAutoWritesPerIncident" >= 0 AND "runbookAutoNonIdempotentPerIncident" >= 0);
ALTER TABLE "RunbookAgentPoolMember" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'EXPLICIT';
ALTER TABLE "ServiceRunbookBinding" ADD COLUMN "agentSelector" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "RunbookAgent" ADD COLUMN "capabilityReport" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "trustedSigningKeys" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "RunbookExecutionSigningKey" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "activatedAt" TIMESTAMP(3), ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "RunbookExecutionSigningKey" ADD CONSTRAINT "runbook_signing_state" CHECK ("state" IN ('ACTIVE','NEXT','RETIRING','RETIRED'));
CREATE UNIQUE INDEX "RunbookExecutionSigningKey_one_active" ON "RunbookExecutionSigningKey" ("state") WHERE "state" = 'ACTIVE';
CREATE UNIQUE INDEX "RunbookExecutionSigningKey_one_next" ON "RunbookExecutionSigningKey" ("state") WHERE "state" = 'NEXT';
CREATE INDEX "RunbookAgent_enrollmentTokenHash_idx" ON "RunbookAgent" ("enrollmentTokenHash");
ALTER TABLE "RunbookExecutionStep" ADD COLUMN "containerRuntime" TEXT NOT NULL DEFAULT 'docker';
ALTER TABLE "RunbookExecutionStep" ADD COLUMN "verificationResult" JSONB;
UPDATE "RunbookExecutionStep" SET "containerRuntime" = 'podman' WHERE "type" = 'DOCKER' AND "config"->>'runtime' = 'podman';
-- Selector provenance is evidence, not a second authoritative execution target.
ALTER TABLE "RunbookExecution" ADD COLUMN "targetSelection" JSONB NOT NULL DEFAULT '{}';
