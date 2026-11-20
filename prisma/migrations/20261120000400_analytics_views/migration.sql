-- CreateTable
CREATE TABLE "AnalyticsView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "visibility" "DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "emailWeekly" BOOLEAN NOT NULL DEFAULT false,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsView_userId_createdAt_id_idx" ON "AnalyticsView"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AnalyticsView_teamId_createdAt_id_idx" ON "AnalyticsView"("teamId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AnalyticsView_emailWeekly_lastSentAt_idx" ON "AnalyticsView"("emailWeekly", "lastSentAt");

-- AddForeignKey
ALTER TABLE "AnalyticsView" ADD CONSTRAINT "AnalyticsView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsView" ADD CONSTRAINT "AnalyticsView_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

