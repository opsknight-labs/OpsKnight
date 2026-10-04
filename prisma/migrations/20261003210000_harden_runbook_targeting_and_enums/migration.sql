-- Convert the initial TEXT runbook columns to real PostgreSQL enums so the
-- database and Prisma schema enforce the same state machine.
CREATE TYPE "RunbookVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "RunbookBindingMode" AS ENUM ('MANUAL', 'SUGGESTED', 'AUTOMATIC');
CREATE TYPE "RunbookVersionStrategy" AS ENUM ('PINNED', 'LATEST_PUBLISHED');
CREATE TYPE "RunbookTriggerEvent" AS ENUM ('INCIDENT_CREATED', 'INCIDENT_UPDATED', 'URGENCY_CHANGED', 'STATUS_CHANGED', 'ALERT_RECEIVED', 'MANUAL', 'API', 'CHATOPS', 'SCHEDULED');
CREATE TYPE "RunbookExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'TIMED_OUT');
CREATE TYPE "RunbookStepType" AS ENUM ('MANUAL', 'APPROVAL', 'CONDITION', 'WAIT', 'HTTP', 'LINUX_DIAGNOSTICS', 'SYSTEMD', 'DOCKER', 'KUBERNETES', 'BASH');
CREATE TYPE "RunbookRiskClass" AS ENUM ('READ_ONLY', 'IDEMPOTENT_WRITE', 'NON_IDEMPOTENT');
CREATE TYPE "RunbookStepStatus" AS ENUM ('PENDING', 'READY', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'UNKNOWN');
CREATE TYPE "RunbookAttemptStatus" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN');
CREATE TYPE "RunbookAgentStatus" AS ENUM ('ENROLLING', 'ONLINE', 'DEGRADED', 'OFFLINE', 'REVOKED');
CREATE TYPE "RunbookAgentPoolMode" AS ENUM ('LOCAL_HOSTS', 'SHARED_TARGET');
CREATE TYPE "RunbookConditionOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'CONTAINS', 'STARTS_WITH', 'IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS');
CREATE TYPE "RunbookInputType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'URL', 'DURATION', 'SECRET_REF', 'SELECT');
CREATE TYPE "RunbookTriggerByType" AS ENUM ('USER', 'TRIGGER', 'API', 'CHATOPS', 'SCHEDULE');
CREATE TYPE "RunbookConditionLogic" AS ENUM ('AND', 'OR');

ALTER TABLE "RunbookVersion" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "RunbookVersion" ALTER COLUMN "state" TYPE "RunbookVersionState" USING "state"::"RunbookVersionState";
ALTER TABLE "RunbookVersion" ALTER COLUMN "state" SET DEFAULT 'DRAFT';
ALTER TABLE "RunbookInput" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "RunbookInput" ALTER COLUMN "type" TYPE "RunbookInputType" USING "type"::"RunbookInputType";
ALTER TABLE "RunbookInput" ALTER COLUMN "type" SET DEFAULT 'STRING';
ALTER TABLE "ServiceRunbookBinding" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "ServiceRunbookBinding" ALTER COLUMN "mode" TYPE "RunbookBindingMode" USING "mode"::"RunbookBindingMode";
ALTER TABLE "ServiceRunbookBinding" ALTER COLUMN "mode" SET DEFAULT 'MANUAL';
ALTER TABLE "ServiceRunbookBinding" ALTER COLUMN "versionStrategy" DROP DEFAULT;
ALTER TABLE "ServiceRunbookBinding" ALTER COLUMN "versionStrategy" TYPE "RunbookVersionStrategy" USING "versionStrategy"::"RunbookVersionStrategy";
ALTER TABLE "ServiceRunbookBinding" ALTER COLUMN "versionStrategy" SET DEFAULT 'LATEST_PUBLISHED';
ALTER TABLE "RunbookTrigger" ALTER COLUMN "event" TYPE "RunbookTriggerEvent" USING "event"::"RunbookTriggerEvent";
ALTER TABLE "RunbookTrigger" ALTER COLUMN "conditionLogic" DROP DEFAULT;
ALTER TABLE "RunbookTrigger" ALTER COLUMN "conditionLogic" TYPE "RunbookConditionLogic" USING "conditionLogic"::"RunbookConditionLogic";
ALTER TABLE "RunbookTrigger" ALTER COLUMN "conditionLogic" SET DEFAULT 'AND';
ALTER TABLE "RunbookTriggerCondition" ALTER COLUMN "operator" TYPE "RunbookConditionOperator" USING "operator"::"RunbookConditionOperator";
ALTER TABLE "RunbookExecution" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RunbookExecution" ALTER COLUMN "status" TYPE "RunbookExecutionStatus" USING "status"::"RunbookExecutionStatus";
ALTER TABLE "RunbookExecution" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
ALTER TABLE "RunbookExecution" ALTER COLUMN "triggeredByType" DROP DEFAULT;
ALTER TABLE "RunbookExecution" ALTER COLUMN "triggeredByType" TYPE "RunbookTriggerByType" USING "triggeredByType"::"RunbookTriggerByType";
ALTER TABLE "RunbookExecution" ALTER COLUMN "triggeredByType" SET DEFAULT 'USER';
ALTER TABLE "RunbookExecutionStep" ALTER COLUMN "type" TYPE "RunbookStepType" USING "type"::"RunbookStepType";
ALTER TABLE "RunbookExecutionStep" ALTER COLUMN "riskClass" DROP DEFAULT;
ALTER TABLE "RunbookExecutionStep" ALTER COLUMN "riskClass" TYPE "RunbookRiskClass" USING "riskClass"::"RunbookRiskClass";
ALTER TABLE "RunbookExecutionStep" ALTER COLUMN "riskClass" SET DEFAULT 'READ_ONLY';
ALTER TABLE "RunbookExecutionStep" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RunbookExecutionStep" ALTER COLUMN "status" TYPE "RunbookStepStatus" USING "status"::"RunbookStepStatus";
ALTER TABLE "RunbookExecutionStep" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "RunbookStepAttempt" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RunbookStepAttempt" ALTER COLUMN "status" TYPE "RunbookAttemptStatus" USING "status"::"RunbookAttemptStatus";
ALTER TABLE "RunbookStepAttempt" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "RunbookAgent" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RunbookAgent" ALTER COLUMN "status" TYPE "RunbookAgentStatus" USING "status"::"RunbookAgentStatus";
ALTER TABLE "RunbookAgent" ALTER COLUMN "status" SET DEFAULT 'ENROLLING';
ALTER TABLE "RunbookAgentPool" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "RunbookAgentPool" ALTER COLUMN "mode" TYPE "RunbookAgentPoolMode" USING "mode"::"RunbookAgentPoolMode";
ALTER TABLE "RunbookAgentPool" ALTER COLUMN "mode" SET DEFAULT 'SHARED_TARGET';

-- Separate immutable targeting from the Agent that claims an attempt.
ALTER TABLE "RunbookStepAttempt" DROP CONSTRAINT IF EXISTS "RunbookStepAttempt_agentId_fkey";
ALTER TABLE "RunbookStepAttempt" DROP CONSTRAINT IF EXISTS "RunbookStepAttempt_agentPoolId_fkey";
DROP INDEX IF EXISTS "RunbookStepAttempt_agentId_idx";
ALTER TABLE "RunbookStepAttempt" RENAME COLUMN "agentId" TO "targetAgentId";
ALTER TABLE "RunbookStepAttempt" RENAME COLUMN "agentPoolId" TO "targetAgentPoolId";
ALTER TABLE "RunbookStepAttempt" ADD COLUMN "claimedAgentId" TEXT;
ALTER TABLE "RunbookStepAttempt" ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "RunbookStepAttempt_targetAgentId_idx" ON "RunbookStepAttempt"("targetAgentId");
CREATE INDEX "RunbookStepAttempt_targetAgentPoolId_idx" ON "RunbookStepAttempt"("targetAgentPoolId");
CREATE INDEX "RunbookStepAttempt_claimedAgentId_idx" ON "RunbookStepAttempt"("claimedAgentId");
CREATE INDEX "RunbookStepAttempt_status_availableAt_idx" ON "RunbookStepAttempt"("status", "availableAt");
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "RunbookAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_targetAgentPoolId_fkey" FOREIGN KEY ("targetAgentPoolId") REFERENCES "RunbookAgentPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_claimedAgentId_fkey" FOREIGN KEY ("claimedAgentId") REFERENCES "RunbookAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Snapshot target identity on the execution and relate trigger provenance.
ALTER TABLE "RunbookExecution"
  ADD COLUMN "resolvedTargetAgentId" TEXT,
  ADD COLUMN "resolvedTargetAgentPoolId" TEXT;
CREATE INDEX "RunbookExecution_triggerId_idx" ON "RunbookExecution"("triggerId");
CREATE INDEX "RunbookExecution_resolvedTargetAgentId_idx" ON "RunbookExecution"("resolvedTargetAgentId");
CREATE INDEX "RunbookExecution_resolvedTargetAgentPoolId_idx" ON "RunbookExecution"("resolvedTargetAgentPoolId");
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "RunbookTrigger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_resolvedTargetAgentId_fkey" FOREIGN KEY ("resolvedTargetAgentId") REFERENCES "RunbookAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_resolvedTargetAgentPoolId_fkey" FOREIGN KEY ("resolvedTargetAgentPoolId") REFERENCES "RunbookAgentPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_single_target_check" CHECK (NOT ("resolvedTargetAgentId" IS NOT NULL AND "resolvedTargetAgentPoolId" IS NOT NULL));
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_single_target_check" CHECK (NOT ("targetAgentId" IS NOT NULL AND "targetAgentPoolId" IS NOT NULL));
ALTER TABLE "RunbookExecutionStep" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- Store suggestions as durable, queryable state instead of encoding identity in
-- human-readable incident event messages.
CREATE TYPE "RunbookSuggestionState" AS ENUM ('SUGGESTED', 'STARTED', 'DISMISSED');
CREATE TABLE "RunbookSuggestion" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "runbookVersionId" TEXT NOT NULL,
  "triggerId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "state" "RunbookSuggestionState" NOT NULL DEFAULT 'SUGGESTED',
  "startedAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RunbookSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookSuggestion_fingerprint_key" ON "RunbookSuggestion"("fingerprint");
CREATE INDEX "RunbookSuggestion_incidentId_state_idx" ON "RunbookSuggestion"("incidentId", "state");
CREATE INDEX "RunbookSuggestion_bindingId_idx" ON "RunbookSuggestion"("bindingId");
CREATE INDEX "RunbookSuggestion_triggerId_idx" ON "RunbookSuggestion"("triggerId");
ALTER TABLE "RunbookSuggestion" ADD CONSTRAINT "RunbookSuggestion_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookSuggestion" ADD CONSTRAINT "RunbookSuggestion_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ServiceRunbookBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookSuggestion" ADD CONSTRAINT "RunbookSuggestion_runbookVersionId_fkey" FOREIGN KEY ("runbookVersionId") REFERENCES "RunbookVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunbookSuggestion" ADD CONSTRAINT "RunbookSuggestion_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "RunbookTrigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
