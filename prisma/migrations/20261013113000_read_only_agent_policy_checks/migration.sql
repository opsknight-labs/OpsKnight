CREATE TABLE "RunbookPolicyCheck" (
  id TEXT NOT NULL PRIMARY KEY,
  "ruleId" TEXT NOT NULL REFERENCES "ServiceRunbookBinding"(id) ON DELETE CASCADE,
  "agentId" TEXT NOT NULL REFERENCES "RunbookAgent"(id) ON DELETE CASCADE,
  "versionId" TEXT NOT NULL REFERENCES "RunbookVersion"(id) ON DELETE RESTRICT,
  checksum TEXT NOT NULL,
  steps JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "policyHash" TEXT,
  results JSONB NOT NULL DEFAULT '[]',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "checkedAt" TIMESTAMP(3),
  "createdById" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunbookPolicyCheck_status_check" CHECK (status IN ('PENDING','PASSED','BLOCKED'))
);
CREATE INDEX "RunbookPolicyCheck_agentId_status_expiresAt_idx" ON "RunbookPolicyCheck"("agentId",status,"expiresAt");
CREATE INDEX "RunbookPolicyCheck_ruleId_createdAt_idx" ON "RunbookPolicyCheck"("ruleId","createdAt");
