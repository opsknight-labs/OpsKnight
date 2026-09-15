-- Delivery failure observability for retry exhaustion.
ALTER TABLE "WarRoomProviderEventDelivery" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMPTZ(3);
ALTER TABLE "WarRoomProviderEventDelivery" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "WarRoomProviderEventDelivery" ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT;
