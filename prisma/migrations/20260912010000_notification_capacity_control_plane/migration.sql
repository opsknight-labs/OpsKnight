-- Notification capacity control plane — typed provider/channel capacity + runtime watermarks
-- DB wins over legacy env, TTL-cached at process (~5s); no restart required.

-- CreateEnum
CREATE TYPE "NotificationCapacityMode" AS ENUM ('AUTO', 'CUSTOM');

-- CreateTable
CREATE TABLE "NotificationProviderCapacity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "mode" "NotificationCapacityMode" NOT NULL DEFAULT 'AUTO',
    "ratePerSecond" INTEGER,
    "maxInFlight" INTEGER,
    "bulkSharePercent" INTEGER NOT NULL DEFAULT 80,
    "adaptiveBackpressure" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationProviderCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRuntimeSettings" (
    "id" TEXT NOT NULL,
    "bulkQueueLowWatermark" INTEGER NOT NULL DEFAULT 5000,
    "bulkQueueHighWatermark" INTEGER NOT NULL DEFAULT 25000,
    "defaultBulkSharePercent" INTEGER NOT NULL DEFAULT 80,
    "adaptiveBackpressure" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRuntimeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationProviderCapacity_provider_channel_key" ON "NotificationProviderCapacity"("provider", "channel");
CREATE INDEX "NotificationProviderCapacity_updatedAt_idx" ON "NotificationProviderCapacity"("updatedAt");
