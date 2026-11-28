ALTER TABLE "UserNotificationEndpoint" ADD COLUMN IF NOT EXISTS "lastResetAt" TIMESTAMP(3);
