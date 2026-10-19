-- Nullable for compatibility with pre-upgrade jobs/workers. Only token-owned
-- operational claims use the shorter recovery timeout. Retry budget counters
-- can be decremented, so they cannot identify a claim generation by themselves.
ALTER TABLE "BackgroundJob" ADD COLUMN "claimToken" UUID;
