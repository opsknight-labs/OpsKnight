-- Cancellation is terminal non-delivery; existing pending/delivered rows retain their meaning.
ALTER TABLE "AuthenticationAlert" ADD COLUMN "cancelledAt" TIMESTAMP(3);
CREATE INDEX "AuthenticationAlert_deliveredAt_cancelledAt_nextAttemptAt_idx"
  ON "AuthenticationAlert"("deliveredAt", "cancelledAt", "nextAttemptAt");
CREATE INDEX "AuthenticationAlert_cancelledAt_idx" ON "AuthenticationAlert"("cancelledAt");
DROP INDEX "AuthenticationAlert_deliveredAt_nextAttemptAt_idx";
