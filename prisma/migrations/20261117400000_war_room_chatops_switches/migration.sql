-- War-room kickoff and channel capture (M4): two defaulted switches, default off, and one timeline kind.
-- Expand-only: no row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "warRoomKickoffEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "warRoomCaptureEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'CHAT_MESSAGE';
