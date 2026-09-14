-- Desired-version fencing for participant membership mutations. Lets the sync
-- detect stale Graph side effects that raced with a concurrent projection.
ALTER TABLE "WarRoomParticipant" ADD COLUMN "desiredVersion" INTEGER NOT NULL DEFAULT 0;
