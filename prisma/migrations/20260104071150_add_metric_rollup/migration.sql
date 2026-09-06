-- CreateTable
CREATE TABLE "MetricRollup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "serviceId" TEXT,
    "count" INTEGER NOT NULL,
    "sum" DOUBLE PRECISION NOT NULL,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricRollup_name_bucket_idx" ON "MetricRollup"("name", "bucket");

-- CreateIndex
CREATE INDEX "MetricRollup_serviceId_bucket_idx" ON "MetricRollup"("serviceId", "bucket");

-- CreateIndex
CREATE INDEX "MetricRollup_bucket_idx" ON "MetricRollup"("bucket");
