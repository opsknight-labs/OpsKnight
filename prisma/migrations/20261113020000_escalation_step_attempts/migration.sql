-- Additive only: one new table and nullable/defaulted columns. No existing row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "Incident" ADD COLUMN "acknowledgedById" TEXT;
ALTER TABLE "Incident" ADD COLUMN "acknowledgedVia" TEXT;

CREATE TABLE "EscalationStepAttempt" (
  "incidentId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "stepIndex" INTEGER NOT NULL,
  "policyId" TEXT,
  "policyRevision" INTEGER,
  "targetType" TEXT,
  "targetId" TEXT,
  "resolvedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "outcome" TEXT NOT NULL,
  "skipReason" TEXT,
  "notifiedAt" TIMESTAMP(3),
  "approximate" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EscalationStepAttempt_pkey" PRIMARY KEY ("incidentId", "generation", "stepIndex"),
  CONSTRAINT "EscalationStepAttempt_incidentId_fkey" FOREIGN KEY ("incidentId")
    REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- The daily step-outcome rollup reads one UTC day of attempts at a time.
CREATE INDEX "idx_escalation_step_attempt_created" ON "EscalationStepAttempt" ("createdAt");
