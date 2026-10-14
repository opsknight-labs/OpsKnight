-- Additive evidence table; no execution, Agent identity or existing foreign keys change.
CREATE TABLE "RuntimeWorkerHeartbeat" (
  "instanceId" TEXT NOT NULL,
  "lane" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "runbookEnabled" BOOLEAN NOT NULL DEFAULT false,
  "running" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSuccessAt" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeWorkerHeartbeat_pkey" PRIMARY KEY ("instanceId")
);
CREATE INDEX "RuntimeWorkerHeartbeat_runbookEnabled_running_lastSeenAt_idx"
  ON "RuntimeWorkerHeartbeat"("runbookEnabled", "running", "lastSeenAt");
