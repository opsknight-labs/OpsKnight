ALTER TABLE "AuthenticationAlert" ADD COLUMN "acceptedAt" TIMESTAMP(3), ADD COLUMN "notificationId" TEXT;
-- Older completion timestamps proved submission only. Preserve them without asserting delivery.
UPDATE "AuthenticationAlert" SET "acceptedAt" = "deliveredAt", "deliveredAt" = NULL WHERE "deliveredAt" IS NOT NULL;
CREATE INDEX "AuthenticationAlert_acceptedAt_deliveredAt_cancelledAt_fail_idx" ON "AuthenticationAlert"("acceptedAt", "deliveredAt", "cancelledAt", "failedAt", "nextAttemptAt");
CREATE INDEX "AuthenticationAlert_notificationId_idx" ON "AuthenticationAlert"("notificationId");
DROP INDEX "AuthenticationAlert_deliveredAt_cancelledAt_failedAt_nextAt_idx";
CREATE INDEX "AuthenticationAlert_deliveredAt_idx" ON "AuthenticationAlert"("deliveredAt");
