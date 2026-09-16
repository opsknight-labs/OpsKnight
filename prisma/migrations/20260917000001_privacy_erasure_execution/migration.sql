-- Verified subject erasure + anonymization: execution tracking table.

CREATE TYPE "PrivacyErasureExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED');

CREATE TABLE "PrivacyErasureExecution" (
  "id"            TEXT NOT NULL,
  "requestId"     TEXT NOT NULL,
  "status"        "PrivacyErasureExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "planVersion"   INTEGER NOT NULL DEFAULT 1,
  "resultSummary" JSONB,
  "failureCode"   TEXT,
  "startedAt"     TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PrivacyErasureExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivacyErasureExecution_requestId_key" ON "PrivacyErasureExecution"("requestId");
CREATE INDEX "PrivacyErasureExecution_status_idx" ON "PrivacyErasureExecution"("status");

ALTER TABLE "PrivacyErasureExecution"
  ADD CONSTRAINT "PrivacyErasureExecution_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "PrivacyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
