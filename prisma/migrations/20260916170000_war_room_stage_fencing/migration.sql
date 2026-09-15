-- Expand WarRoomProviderEventStageStatus enum values (preserve existing ones).
-- This migration contains ONLY enum changes to satisfy validate-migrations transaction safety.
ALTER TYPE "WarRoomProviderEventStageStatus" ADD VALUE IF NOT EXISTS 'ATTEMPTING';
ALTER TYPE "WarRoomProviderEventStageStatus" ADD VALUE IF NOT EXISTS 'AMBIGUOUS';
