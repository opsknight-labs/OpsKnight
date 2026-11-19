-- War-room kickoff and channel capture (M4): two defaulted switches, default off.
-- The CHAT_MESSAGE timeline kind is in 20261117400050 (an enum change must stand alone).
-- Expand-only: no row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "warRoomKickoffEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "warRoomCaptureEnabled" BOOLEAN NOT NULL DEFAULT false;
