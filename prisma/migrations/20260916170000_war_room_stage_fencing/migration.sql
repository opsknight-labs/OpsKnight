-- Harden provider delivery fencing + stage operation fencing.
DO $$ BEGIN
  CREATE TYPE "WarRoomProviderEventStageStatus_new" AS ENUM ('PENDING','ATTEMPTING','COMPLETED','FAILED','AMBIGUOUS','SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Expand enum values (preserve existing ones).
ALTER TYPE "WarRoomProviderEventStageStatus" ADD VALUE IF NOT EXISTS 'ATTEMPTING';
ALTER TYPE "WarRoomProviderEventStageStatus" ADD VALUE IF NOT EXISTS 'AMBIGUOUS';

ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "operationId" TEXT;
ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "leaseToken" TEXT;
ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMPTZ(3);
ALTER TABLE "WarRoomProviderEventStage" ADD COLUMN IF NOT EXISTS "attemptStartedAt" TIMESTAMPTZ(3);
