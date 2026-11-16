-- Additive only: one new table. No existing row is rewritten or backfilled.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

CREATE TABLE "OnCallCoverageDay" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "userId" TEXT NOT NULL,
  "layerId" TEXT NOT NULL,
  "seconds" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnCallCoverageDay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnCallCoverageDay_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OnCallSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OnCallCoverageDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OnCallCoverageDay_scheduleId_date_userId_layerId_key" ON "OnCallCoverageDay"("scheduleId", "date", "userId", "layerId");
CREATE INDEX "OnCallCoverageDay_userId_date_idx" ON "OnCallCoverageDay"("userId", "date");
