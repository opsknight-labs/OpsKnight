ALTER TABLE "AuthenticationAlert" ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryGeneration" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "AuthenticationAlert_deliveredAt_cancelledAt_failedAt_nextAt_idx"
  ON "AuthenticationAlert"("deliveredAt", "cancelledAt", "failedAt", "nextAttemptAt");
CREATE INDEX "AuthenticationAlert_failedAt_idx" ON "AuthenticationAlert"("failedAt");
DROP INDEX "AuthenticationAlert_deliveredAt_cancelledAt_nextAttemptAt_idx";
