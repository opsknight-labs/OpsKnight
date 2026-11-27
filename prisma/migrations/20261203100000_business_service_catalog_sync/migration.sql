-- Scheduled Backstage sync of business services. Additive: existing rows keep NULL / false.

-- AlterTable
ALTER TABLE "BusinessService" ADD COLUMN "externalKey" TEXT,
ADD COLUMN "externalRemovedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TopologySource" ADD COLUMN "syncBusinessServices" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "syncDomains" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "uq_business_service_external_key" ON "BusinessService"("externalKey");
