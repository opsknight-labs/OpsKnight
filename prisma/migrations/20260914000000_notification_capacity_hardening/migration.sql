-- Harden notification capacity control plane with DB CHECK constraints (defense-in-depth).
-- Resolver already clamps, but a bad manual edit / stale migration must not silently widen fanout.

-- Provider/channel capacity bounds: mirror HARD_LIMITS (rate 1–10_000, inFlight 1–5_000, bulk 5–95, revision >=1)
ALTER TABLE "NotificationProviderCapacity" DROP CONSTRAINT IF EXISTS "NotificationProviderCapacity_ratePerSecond_check";
ALTER TABLE "NotificationProviderCapacity" ADD CONSTRAINT "NotificationProviderCapacity_ratePerSecond_check"
  CHECK ("ratePerSecond" IS NULL OR ("ratePerSecond" >= 1 AND "ratePerSecond" <= 10000));

ALTER TABLE "NotificationProviderCapacity" DROP CONSTRAINT IF EXISTS "NotificationProviderCapacity_maxInFlight_check";
ALTER TABLE "NotificationProviderCapacity" ADD CONSTRAINT "NotificationProviderCapacity_maxInFlight_check"
  CHECK ("maxInFlight" IS NULL OR ("maxInFlight" >= 1 AND "maxInFlight" <= 5000));

ALTER TABLE "NotificationProviderCapacity" DROP CONSTRAINT IF EXISTS "NotificationProviderCapacity_bulkSharePercent_check";
ALTER TABLE "NotificationProviderCapacity" ADD CONSTRAINT "NotificationProviderCapacity_bulkSharePercent_check"
  CHECK ("bulkSharePercent" >= 5 AND "bulkSharePercent" <= 95);

ALTER TABLE "NotificationProviderCapacity" DROP CONSTRAINT IF EXISTS "NotificationProviderCapacity_revision_check";
ALTER TABLE "NotificationProviderCapacity" ADD CONSTRAINT "NotificationProviderCapacity_revision_check"
  CHECK ("revision" >= 1);

-- Runtime watermarks + default bulk share + revision
ALTER TABLE "NotificationRuntimeSettings" DROP CONSTRAINT IF EXISTS "NotificationRuntimeSettings_lowWatermark_check";
ALTER TABLE "NotificationRuntimeSettings" ADD CONSTRAINT "NotificationRuntimeSettings_lowWatermark_check"
  CHECK ("bulkQueueLowWatermark" >= 100 AND "bulkQueueLowWatermark" <= 1000000);

ALTER TABLE "NotificationRuntimeSettings" DROP CONSTRAINT IF EXISTS "NotificationRuntimeSettings_highWatermark_check";
ALTER TABLE "NotificationRuntimeSettings" ADD CONSTRAINT "NotificationRuntimeSettings_highWatermark_check"
  CHECK ("bulkQueueHighWatermark" >= 1000 AND "bulkQueueHighWatermark" <= 1000000);

ALTER TABLE "NotificationRuntimeSettings" DROP CONSTRAINT IF EXISTS "NotificationRuntimeSettings_watermark_order_check";
ALTER TABLE "NotificationRuntimeSettings" ADD CONSTRAINT "NotificationRuntimeSettings_watermark_order_check"
  CHECK ("bulkQueueHighWatermark" >= "bulkQueueLowWatermark");

ALTER TABLE "NotificationRuntimeSettings" DROP CONSTRAINT IF EXISTS "NotificationRuntimeSettings_defaultBulkSharePercent_check";
ALTER TABLE "NotificationRuntimeSettings" ADD CONSTRAINT "NotificationRuntimeSettings_defaultBulkSharePercent_check"
  CHECK ("defaultBulkSharePercent" >= 5 AND "defaultBulkSharePercent" <= 95);

ALTER TABLE "NotificationRuntimeSettings" DROP CONSTRAINT IF EXISTS "NotificationRuntimeSettings_revision_check";
ALTER TABLE "NotificationRuntimeSettings" ADD CONSTRAINT "NotificationRuntimeSettings_revision_check"
  CHECK ("revision" >= 1);
