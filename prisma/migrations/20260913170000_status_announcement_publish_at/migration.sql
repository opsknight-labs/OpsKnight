-- AlterTable
ALTER TABLE "StatusPageAnnouncement" ADD COLUMN "publishAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "StatusPageAnnouncement_statusPageId_isActive_publishAt_idx" ON "StatusPageAnnouncement"("statusPageId", "isActive", "publishAt");
