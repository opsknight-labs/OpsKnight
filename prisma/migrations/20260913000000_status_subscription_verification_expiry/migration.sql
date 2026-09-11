-- Add verification expiry for status page subscriptions (7-day TTL, matches email template)
ALTER TABLE "StatusPageSubscription" ADD COLUMN IF NOT EXISTS "verificationTokenExpiresAt" TIMESTAMP(3);
