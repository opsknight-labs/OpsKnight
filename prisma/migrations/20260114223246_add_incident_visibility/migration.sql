-- CreateEnum
CREATE TYPE "IncidentVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "targetEmail" TEXT;

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "visibility" "IncidentVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateIndex
CREATE INDEX "AuditLog_action_ip_createdAt_idx" ON "AuditLog"("action", "ip", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_targetEmail_createdAt_idx" ON "AuditLog"("action", "targetEmail", "createdAt");
