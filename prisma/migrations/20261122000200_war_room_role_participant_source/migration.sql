-- War-room participants invited because they hold an incident role.
ALTER TYPE "WarRoomParticipantSource" ADD VALUE IF NOT EXISTS 'ROLE';
