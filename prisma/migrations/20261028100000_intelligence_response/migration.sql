-- OpsKnight Intelligence: service dependencies and change events. Purely additive.
BEGIN;

-- CreateEnum
CREATE TYPE "DependencyOrigin" AS ENUM ('DECLARED', 'OBSERVED');

-- CreateEnum
CREATE TYPE "DependencyStatus" AS ENUM ('ACTIVE', 'SUGGESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('DEPLOY', 'CONFIG', 'FEATURE_FLAG', 'INFRA');

-- CreateTable
CREATE TABLE "ServiceDependency" (
    "id" TEXT NOT NULL,
    "upstreamServiceId" TEXT NOT NULL,
    "downstreamServiceId" TEXT NOT NULL,
    "origin" "DependencyOrigin" NOT NULL,
    "status" "DependencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT,
    "source" TEXT NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "version" TEXT,
    "url" TEXT,
    "dedupKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceDependency_downstreamServiceId_status_idx" ON "ServiceDependency"("downstreamServiceId", "status");

-- CreateIndex
CREATE INDEX "ServiceDependency_upstreamServiceId_status_idx" ON "ServiceDependency"("upstreamServiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDependency_upstreamServiceId_downstreamServiceId_key" ON "ServiceDependency"("upstreamServiceId", "downstreamServiceId");

-- CreateIndex
CREATE INDEX "idx_change_event_service_recent" ON "ChangeEvent"("serviceId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "idx_change_event_retention" ON "ChangeEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_change_event_source_dedup" ON "ChangeEvent"("source", "dedupKey");

-- AddForeignKey
ALTER TABLE "ServiceDependency" ADD CONSTRAINT "ServiceDependency_upstreamServiceId_fkey" FOREIGN KEY ("upstreamServiceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDependency" ADD CONSTRAINT "ServiceDependency_downstreamServiceId_fkey" FOREIGN KEY ("downstreamServiceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity constraints Prisma cannot express.
ALTER TABLE "ServiceDependency"
  ADD CONSTRAINT "ServiceDependency_distinct_check" CHECK ("upstreamServiceId" <> "downstreamServiceId"),
  ADD CONSTRAINT "ServiceDependency_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1);
ALTER TABLE "ChangeEvent"
  ADD CONSTRAINT "ChangeEvent_summary_check" CHECK (char_length("summary") BETWEEN 1 AND 300),
  ADD CONSTRAINT "ChangeEvent_source_check" CHECK (char_length("source") BETWEEN 1 AND 64),
  ADD CONSTRAINT "ChangeEvent_url_check" CHECK ("url" IS NULL OR char_length("url") <= 500);

COMMIT;
