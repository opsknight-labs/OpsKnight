ALTER TABLE "RunbookStepAttempt"
ADD COLUMN "requiresConfidentialTransport" BOOLEAN NOT NULL DEFAULT false;

-- Conservatively protect existing attempts with any execution secret reference.
-- New attempts compute the requirement from step-scoped input references.
UPDATE "RunbookStepAttempt" AS attempt
SET "requiresConfidentialTransport" = true
FROM "RunbookExecutionStep" AS step, "RunbookExecution" AS execution
WHERE attempt."executionStepId" = step."id"
  AND step."executionId" = execution."id"
  AND EXISTS (
    SELECT 1 FROM jsonb_each(execution."inputValues") AS input
    WHERE jsonb_typeof(input.value) = 'string'
      AND (input.value #>> '{}') LIKE 'secret://%'
  );

CREATE INDEX "RunbookStepAttempt_transport_status_createdAt_idx"
ON "RunbookStepAttempt" ("requiresConfidentialTransport", "status", "createdAt");
