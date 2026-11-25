-- Last announced health status per business service, so the reconcile can detect a change
-- exactly once across instances. Internal state: no status-page snapshot trigger needed.
ALTER TABLE "BusinessService"
ADD COLUMN "lastNotifiedStatus" TEXT,
ADD COLUMN "lastNotifiedStatusAt" TIMESTAMP(3);
