-- CreateEnum
CREATE TYPE "DashboardVisibility" AS ENUM ('PRIVATE', 'TEAM', 'PUBLIC');

-- CreateTable
CREATE TABLE "Dashboard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT,
    "layout" JSONB NOT NULL,
    "config" JSONB,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWidget" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "widgetType" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "title" TEXT,
    "position" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dashboard_userId_idx" ON "Dashboard"("userId");

-- CreateIndex
CREATE INDEX "Dashboard_teamId_idx" ON "Dashboard"("teamId");

-- CreateIndex
CREATE INDEX "Dashboard_isTemplate_idx" ON "Dashboard"("isTemplate");

-- CreateIndex
CREATE INDEX "DashboardWidget_dashboardId_idx" ON "DashboardWidget"("dashboardId");

-- AddForeignKey
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
