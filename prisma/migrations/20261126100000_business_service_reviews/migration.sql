-- AlterTable
ALTER TABLE "BusinessService" ADD COLUMN "includeInReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "receiveServiceReviews" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BusinessServiceReviewRun" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "serviceCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessServiceReviewRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessServiceReviewRun_period_createdAt_idx" ON "BusinessServiceReviewRun"("period", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessServiceReviewRun_period_kind_recipientKey_key" ON "BusinessServiceReviewRun"("period", "kind", "recipientKey");
