CREATE TYPE "InboundDeliveryStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "InboundDelivery" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "deliveryHash" TEXT NOT NULL,
  "status" "InboundDeliveryStatus" NOT NULL DEFAULT 'PROCESSING',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundDelivery_integrationId_deliveryHash_key"
ON "InboundDelivery"("integrationId", "deliveryHash");
CREATE INDEX "InboundDelivery_status_leaseExpiresAt_idx"
ON "InboundDelivery"("status", "leaseExpiresAt");
