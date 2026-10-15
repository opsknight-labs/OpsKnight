-- Preserve the existing table, primary keys and every trigger, suggestion, execution and audit reference.
-- Prisma now names this entity ServiceAutomationRule via @@map. Multiple rules may reuse one runbook.
ALTER TABLE "ServiceRunbookBinding" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "ServiceRunbookBinding_serviceId_runbookId_key";
CREATE INDEX "ServiceRunbookBinding_serviceId_runbookId_idx" ON "ServiceRunbookBinding"("serviceId", "runbookId");
