-- Opt-in personal Slack DM paging. Defaults to off, so existing users keep today's channels.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "slackNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;
