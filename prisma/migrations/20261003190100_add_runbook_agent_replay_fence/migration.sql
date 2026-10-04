CREATE TABLE "RunbookAgentRequestNonce" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunbookAgentRequestNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RunbookAgentRequestNonce_agentId_nonceHash_key"
  ON "RunbookAgentRequestNonce"("agentId", "nonceHash");
CREATE INDEX "RunbookAgentRequestNonce_createdAt_idx"
  ON "RunbookAgentRequestNonce"("createdAt");

ALTER TABLE "RunbookAgentRequestNonce"
  ADD CONSTRAINT "RunbookAgentRequestNonce_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "RunbookAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
