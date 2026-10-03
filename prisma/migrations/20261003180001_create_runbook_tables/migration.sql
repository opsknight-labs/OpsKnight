-- CreateTable
CREATE TABLE "Runbook" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "draftVersionId" TEXT,
    "publishedVersionId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Runbook_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Runbook_slug_key" ON "Runbook"("slug");
CREATE UNIQUE INDEX "Runbook_draftVersionId_key" ON "Runbook"("draftVersionId");
CREATE UNIQUE INDEX "Runbook_publishedVersionId_key" ON "Runbook"("publishedVersionId");

-- CreateTable
CREATE TABLE "RunbookVersion" (
    "id" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "checksum" TEXT NOT NULL,
    "createdById" TEXT,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookVersion_runbookId_version_key" ON "RunbookVersion"("runbookId", "version");
CREATE INDEX "RunbookVersion_runbookId_idx" ON "RunbookVersion"("runbookId");
CREATE INDEX "RunbookVersion_state_idx" ON "RunbookVersion"("state");

-- CreateTable
CREATE TABLE "RunbookInput" (
    "id" TEXT NOT NULL,
    "runbookVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'STRING',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookInput_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookInput_runbookVersionId_key_key" ON "RunbookInput"("runbookVersionId", "key");
CREATE INDEX "RunbookInput_runbookVersionId_idx" ON "RunbookInput"("runbookVersionId");

-- CreateTable
CREATE TABLE "ServiceRunbookBinding" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "runbookVersionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "versionStrategy" TEXT NOT NULL DEFAULT 'LATEST_PUBLISHED',
    "defaultAgentPoolId" TEXT,
    "defaultAgentId" TEXT,
    "inputValues" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceRunbookBinding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceRunbookBinding_serviceId_idx" ON "ServiceRunbookBinding"("serviceId");
CREATE INDEX "ServiceRunbookBinding_runbookId_idx" ON "ServiceRunbookBinding"("runbookId");
CREATE UNIQUE INDEX "ServiceRunbookBinding_serviceId_runbookId_key" ON "ServiceRunbookBinding"("serviceId", "runbookId");

-- CreateTable
CREATE TABLE "RunbookTrigger" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "conditionLogic" TEXT NOT NULL DEFAULT 'AND',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookTrigger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RunbookTrigger_bindingId_idx" ON "RunbookTrigger"("bindingId");
CREATE INDEX "RunbookTrigger_event_idx" ON "RunbookTrigger"("event");

-- CreateTable
CREATE TABLE "RunbookTriggerCondition" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookTriggerCondition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RunbookTriggerCondition_triggerId_idx" ON "RunbookTriggerCondition"("triggerId");

-- CreateTable
CREATE TABLE "RunbookExecution" (
    "id" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "runbookVersionId" TEXT NOT NULL,
    "incidentId" TEXT,
    "serviceId" TEXT,
    "bindingId" TEXT,
    "triggerId" TEXT,
    "triggerFingerprint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "triggeredByType" TEXT NOT NULL DEFAULT 'USER',
    "triggeredByUserId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookExecution_triggerFingerprint_key" ON "RunbookExecution"("triggerFingerprint") WHERE "triggerFingerprint" IS NOT NULL;
CREATE INDEX "RunbookExecution_status_updatedAt_idx" ON "RunbookExecution"("status", "updatedAt");
CREATE INDEX "RunbookExecution_incidentId_idx" ON "RunbookExecution"("incidentId");
CREATE INDEX "RunbookExecution_serviceId_idx" ON "RunbookExecution"("serviceId");
CREATE INDEX "RunbookExecution_runbookId_idx" ON "RunbookExecution"("runbookId");
CREATE INDEX "RunbookExecution_runbookVersionId_idx" ON "RunbookExecution"("runbookVersionId");

-- CreateTable
CREATE TABLE "RunbookExecutionStep" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outputPreview" TEXT,
    "outputArtifactId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookExecutionStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookExecutionStep_executionId_sequence_key" ON "RunbookExecutionStep"("executionId", "sequence");
CREATE INDEX "RunbookExecutionStep_executionId_idx" ON "RunbookExecutionStep"("executionId");
CREATE INDEX "RunbookExecutionStep_status_updatedAt_idx" ON "RunbookExecutionStep"("status", "updatedAt");

-- CreateTable
CREATE TABLE "RunbookStepAttempt" (
    "id" TEXT NOT NULL,
    "executionStepId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "agentId" TEXT,
    "agentPoolId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "claimDeadlineAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "planDigest" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "exitCode" INTEGER,
    "outputPreview" TEXT,
    "outputArtifactId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookStepAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookStepAttempt_executionStepId_attemptNumber_key" ON "RunbookStepAttempt"("executionStepId", "attemptNumber");
CREATE INDEX "RunbookStepAttempt_executionStepId_idx" ON "RunbookStepAttempt"("executionStepId");
CREATE INDEX "RunbookStepAttempt_status_updatedAt_idx" ON "RunbookStepAttempt"("status", "updatedAt");
CREATE INDEX "RunbookStepAttempt_agentId_idx" ON "RunbookStepAttempt"("agentId");
CREATE INDEX "RunbookStepAttempt_leaseExpiresAt_idx" ON "RunbookStepAttempt"("leaseExpiresAt") WHERE "leaseExpiresAt" IS NOT NULL;

-- CreateTable
CREATE TABLE "RunbookAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENROLLING',
    "publicKey" TEXT,
    "enrollmentTokenHash" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "version" TEXT,
    "platform" TEXT,
    "labels" JSONB NOT NULL DEFAULT '{}',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookAgent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RunbookAgent_status_idx" ON "RunbookAgent"("status");
CREATE INDEX "RunbookAgent_lastHeartbeatAt_idx" ON "RunbookAgent"("lastHeartbeatAt");

-- CreateTable
CREATE TABLE "RunbookAgentPool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'SHARED_TARGET',
    "matchLabels" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookAgentPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunbookAgentPoolMember" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunbookAgentPoolMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookAgentPoolMember_poolId_agentId_key" ON "RunbookAgentPoolMember"("poolId", "agentId");
CREATE INDEX "RunbookAgentPoolMember_poolId_idx" ON "RunbookAgentPoolMember"("poolId");
CREATE INDEX "RunbookAgentPoolMember_agentId_idx" ON "RunbookAgentPoolMember"("agentId");

-- CreateTable
CREATE TABLE "RunbookSecret" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunbookSecret_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookSecret_name_key" ON "RunbookSecret"("name");

-- AddForeignKey
ALTER TABLE "RunbookVersion" ADD CONSTRAINT "RunbookVersion_runbookId_fkey" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Runbook" ADD CONSTRAINT "Runbook_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "RunbookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Runbook" ADD CONSTRAINT "Runbook_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "RunbookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Runbook" ADD CONSTRAINT "Runbook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookVersion" ADD CONSTRAINT "RunbookVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookVersion" ADD CONSTRAINT "RunbookVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookInput" ADD CONSTRAINT "RunbookInput_runbookVersionId_fkey" FOREIGN KEY ("runbookVersionId") REFERENCES "RunbookVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceRunbookBinding" ADD CONSTRAINT "ServiceRunbookBinding_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceRunbookBinding" ADD CONSTRAINT "ServiceRunbookBinding_runbookId_fkey" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceRunbookBinding" ADD CONSTRAINT "ServiceRunbookBinding_runbookVersionId_fkey" FOREIGN KEY ("runbookVersionId") REFERENCES "RunbookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceRunbookBinding" ADD CONSTRAINT "ServiceRunbookBinding_defaultAgentPoolId_fkey" FOREIGN KEY ("defaultAgentPoolId") REFERENCES "RunbookAgentPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceRunbookBinding" ADD CONSTRAINT "ServiceRunbookBinding_defaultAgentId_fkey" FOREIGN KEY ("defaultAgentId") REFERENCES "RunbookAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceRunbookBinding" ADD CONSTRAINT "ServiceRunbookBinding_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookTrigger" ADD CONSTRAINT "RunbookTrigger_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ServiceRunbookBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookTrigger" ADD CONSTRAINT "RunbookTrigger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookTriggerCondition" ADD CONSTRAINT "RunbookTriggerCondition_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "RunbookTrigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_runbookId_fkey" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_runbookVersionId_fkey" FOREIGN KEY ("runbookVersionId") REFERENCES "RunbookVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ServiceRunbookBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookExecutionStep" ADD CONSTRAINT "RunbookExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "RunbookExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_executionStepId_fkey" FOREIGN KEY ("executionStepId") REFERENCES "RunbookExecutionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "RunbookAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_agentPoolId_fkey" FOREIGN KEY ("agentPoolId") REFERENCES "RunbookAgentPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookAgent" ADD CONSTRAINT "RunbookAgent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookAgent" ADD CONSTRAINT "RunbookAgent_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookAgentPool" ADD CONSTRAINT "RunbookAgentPool_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunbookAgentPoolMember" ADD CONSTRAINT "RunbookAgentPoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "RunbookAgentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookAgentPoolMember" ADD CONSTRAINT "RunbookAgentPoolMember_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "RunbookAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookSecret" ADD CONSTRAINT "RunbookSecret_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
