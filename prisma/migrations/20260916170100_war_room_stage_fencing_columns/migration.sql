-- Stage operation fencing columns for provider delivery stages.
ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "operationId" TEXT;
ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "leaseToken" TEXT;
ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMPTZ(3);
ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "attemptStartedAt" TIMESTAMPTZ(3);
