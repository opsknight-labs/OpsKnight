-- Legacy consumed receipts have an uncertain outcome; never label them successful by inference.
ALTER TABLE "SquireActionReceipt"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "intentEncrypted" TEXT,
  ADD COLUMN "resultEncrypted" TEXT,
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "SquireActionReceipt" ADD CONSTRAINT "squire_action_receipt_status_check"
  CHECK ("status" IN ('RESERVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'));
ALTER TABLE "SquireActionReceipt" ADD CONSTRAINT "squire_action_receipt_version_check"
  CHECK ("version" = 1);
