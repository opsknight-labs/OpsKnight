-- Agent health, least-privilege secret grants, and durable output artifacts.
ALTER TABLE "RunbookAgent"
  ADD COLUMN "policyHash" TEXT,
  ADD COLUMN "spoolDepth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activeAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" TEXT;

CREATE TABLE "RunbookSecretGrant" (
  "id" TEXT NOT NULL,
  "secretId" TEXT NOT NULL,
  "agentId" TEXT,
  "agentPoolId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunbookSecretGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RunbookSecretGrant_exactly_one_target_check"
    CHECK (("agentId" IS NOT NULL)::int + ("agentPoolId" IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX "RunbookSecretGrant_secretId_agentId_key" ON "RunbookSecretGrant"("secretId", "agentId");
CREATE UNIQUE INDEX "RunbookSecretGrant_secretId_agentPoolId_key" ON "RunbookSecretGrant"("secretId", "agentPoolId");
CREATE INDEX "RunbookSecretGrant_agentId_idx" ON "RunbookSecretGrant"("agentId");
CREATE INDEX "RunbookSecretGrant_agentPoolId_idx" ON "RunbookSecretGrant"("agentPoolId");
ALTER TABLE "RunbookSecretGrant" ADD CONSTRAINT "RunbookSecretGrant_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "RunbookSecret"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookSecretGrant" ADD CONSTRAINT "RunbookSecretGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "RunbookAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookSecretGrant" ADD CONSTRAINT "RunbookSecretGrant_agentPoolId_fkey" FOREIGN KEY ("agentPoolId") REFERENCES "RunbookAgentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RunbookArtifact" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'OUTPUT',
  "mediaType" TEXT NOT NULL DEFAULT 'text/plain',
  "encoding" TEXT NOT NULL DEFAULT 'gzip',
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunbookArtifact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RunbookArtifact_attemptId_createdAt_idx" ON "RunbookArtifact"("attemptId", "createdAt");
ALTER TABLE "RunbookArtifact" ADD CONSTRAINT "RunbookArtifact_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "RunbookStepAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunbookStepAttempt" ADD CONSTRAINT "RunbookStepAttempt_outputArtifactId_fkey" FOREIGN KEY ("outputArtifactId") REFERENCES "RunbookArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
