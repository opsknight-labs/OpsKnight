ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'SAVED_REPORT';

CREATE TABLE "SavedReport" (
  "id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "metricKeys" TEXT[] NOT NULL,
  "windowDays" INTEGER NOT NULL DEFAULT 30,
  "serviceId" TEXT,
  "visibility" "DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
  "userId" TEXT NOT NULL,
  "teamId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedReport_windowDays_check" CHECK ("windowDays" BETWEEN 1 AND 90),
  CONSTRAINT "SavedReport_metricKeys_check" CHECK (cardinality("metricKeys") BETWEEN 1 AND 16)
);

CREATE INDEX "SavedReport_userId_createdAt_id_idx" ON "SavedReport"("userId", "createdAt", "id");
CREATE INDEX "SavedReport_teamId_createdAt_id_idx" ON "SavedReport"("teamId", "createdAt", "id");
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER "SavedReport_bump_revision" BEFORE UPDATE ON "SavedReport"
  FOR EACH ROW EXECUTE FUNCTION "bump_resource_revision"();
