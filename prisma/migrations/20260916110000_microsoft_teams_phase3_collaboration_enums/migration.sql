-- Collaboration enums are transaction-unsafe in Postgres: ALTER TYPE ... ADD VALUE
-- cannot run inside the same transaction as other DDL. Keep this migration enum-only.
-- Keep PROCESSING while old workers may still emit it.
ALTER TYPE "WarRoomParticipantState" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WAR_ROOM_PARTICIPANT_SYNC';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WAR_ROOM_PROJECT';
