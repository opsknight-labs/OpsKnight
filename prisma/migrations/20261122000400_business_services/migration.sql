-- Business services: customer-facing groupings of technical services, their followers, and
-- status-page layouts that show them. Additive only: every page stays FLAT until changed.
-- New tables build their indexes inline; the two existing tables only gain optional columns.

-- CreateEnum
CREATE TYPE "StatusPageServiceLayout" AS ENUM ('FLAT', 'BUSINESS', 'BUSINESS_EXPANDABLE');

-- AlterTable
ALTER TABLE "StatusPage" ADD COLUMN IF NOT EXISTS "serviceLayout" "StatusPageServiceLayout" NOT NULL DEFAULT 'FLAT';

-- AlterTable
ALTER TABLE "StatusPageAnnouncement" ADD COLUMN IF NOT EXISTS "affectedBusinessServiceIds" JSONB;

-- CreateTable
CREATE TABLE "StatusPageSubscriptionBusinessService" (
    "subscriptionId" TEXT NOT NULL,
    "businessServiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusPageSubscriptionBusinessService_pkey" PRIMARY KEY ("subscriptionId","businessServiceId")
);

-- CreateTable
CREATE TABLE "BusinessService" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tier" TEXT,
    "ownerTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessServiceMember" (
    "businessServiceId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessServiceMember_pkey" PRIMARY KEY ("businessServiceId","serviceId")
);

-- CreateTable
CREATE TABLE "BusinessServiceFollower" (
    "businessServiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessServiceFollower_pkey" PRIMARY KEY ("businessServiceId","userId")
);

-- CreateTable
CREATE TABLE "StatusPageBusinessService" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "businessServiceId" TEXT NOT NULL,
    "displayName" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "showOnPage" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusPageBusinessService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatusPageSubscriptionBusinessService_businessServiceId_idx" ON "StatusPageSubscriptionBusinessService"("businessServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessService_name_key" ON "BusinessService"("name");

-- CreateIndex
CREATE INDEX "BusinessService_ownerTeamId_idx" ON "BusinessService"("ownerTeamId");

-- CreateIndex
CREATE INDEX "BusinessServiceMember_serviceId_idx" ON "BusinessServiceMember"("serviceId");

-- CreateIndex
CREATE INDEX "BusinessServiceFollower_userId_idx" ON "BusinessServiceFollower"("userId");

-- CreateIndex
CREATE INDEX "StatusPageBusinessService_statusPageId_order_idx" ON "StatusPageBusinessService"("statusPageId", "order");

-- CreateIndex
CREATE INDEX "StatusPageBusinessService_businessServiceId_idx" ON "StatusPageBusinessService"("businessServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageBusinessService_statusPageId_businessServiceId_key" ON "StatusPageBusinessService"("statusPageId", "businessServiceId");

-- AddForeignKey
ALTER TABLE "StatusPageSubscriptionBusinessService" ADD CONSTRAINT "StatusPageSubscriptionBusinessService_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "StatusPageSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageSubscriptionBusinessService" ADD CONSTRAINT "StatusPageSubscriptionBusinessService_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessService" ADD CONSTRAINT "BusinessService_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceMember" ADD CONSTRAINT "BusinessServiceMember_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceMember" ADD CONSTRAINT "BusinessServiceMember_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceFollower" ADD CONSTRAINT "BusinessServiceFollower_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessServiceFollower" ADD CONSTRAINT "BusinessServiceFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageBusinessService" ADD CONSTRAINT "StatusPageBusinessService_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageBusinessService" ADD CONSTRAINT "StatusPageBusinessService_businessServiceId_fkey" FOREIGN KEY ("businessServiceId") REFERENCES "BusinessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
