-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "serviceNotifyOnAck" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "serviceNotifyOnResolved" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "serviceNotifyOnTriggered" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);
