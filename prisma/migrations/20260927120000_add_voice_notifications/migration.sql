-- Add native voice paging to the existing notification control plane.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'VOICE';

ALTER TABLE "User"
ADD COLUMN "voiceNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;
