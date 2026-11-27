-- Slack war-room settings and Slack token rotation (all additive, nullable or defaulted).
ALTER TABLE "ChatOpsConfig" ADD COLUMN IF NOT EXISTS "slackWarRoomPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatOpsConfig" ADD COLUMN IF NOT EXISTS "warRoomArchiveDelayHours" INTEGER;
ALTER TABLE "SlackIntegration" ADD COLUMN IF NOT EXISTS "refreshToken" TEXT;
ALTER TABLE "SlackIntegration" ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3);
