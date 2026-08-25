ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "actorEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "actorName" TEXT;

UPDATE "AuditLog" AS audit
SET
  "actorEmail" = actor."email",
  "actorName" = actor."name"
FROM "User" AS actor
WHERE audit."actorId" = actor."id"
  AND (audit."actorEmail" IS NULL OR audit."actorName" IS NULL);

ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "AuditLog_entityType_createdAt_idx"
  ON "AuditLog"("entityType", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx"
  ON "AuditLog"("action", "createdAt");

CREATE INDEX IF NOT EXISTS "ApiKey_tokenHash_idx" ON "ApiKey"("tokenHash");
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");

-- Prevent concurrent editors from introducing ambiguous escalation/override rows.
-- Preserve every escalation step by deterministically renumbering collisions.
WITH ordered AS (
  SELECT "id", "policyId",
    ROW_NUMBER() OVER (PARTITION BY "policyId" ORDER BY "stepOrder", "id") - 1 AS new_order
  FROM "EscalationRule"
)
UPDATE "EscalationRule" AS rule
SET "stepOrder" = ordered.new_order
FROM ordered
WHERE rule."id" = ordered."id" AND rule."stepOrder" <> ordered.new_order;

-- Exact duplicate overrides are semantically identical; keep the oldest row.
DELETE FROM "OnCallOverride" duplicate
USING "OnCallOverride" canonical
WHERE duplicate."scheduleId" = canonical."scheduleId"
  AND duplicate."userId" = canonical."userId"
  AND duplicate."start" = canonical."start"
  AND duplicate."end" = canonical."end"
  AND (
    duplicate."createdAt" > canonical."createdAt"
    OR (duplicate."createdAt" = canonical."createdAt" AND duplicate."id" > canonical."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "EscalationRule_policyId_stepOrder_key"
  ON "EscalationRule"("policyId", "stepOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "OnCallOverride_scheduleId_userId_start_end_key"
  ON "OnCallOverride"("scheduleId", "userId", "start", "end");
