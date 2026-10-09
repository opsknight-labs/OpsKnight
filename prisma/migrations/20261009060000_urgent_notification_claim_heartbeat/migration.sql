-- Preserve the original claim timestamp as a fence while renewing its lease separately.
-- NULL heartbeats retain the ten-minute legacy lease during rolling deployment.
ALTER TABLE "Notification" ADD COLUMN "claimHeartbeatAt" TIMESTAMP(3);
