-- AlterTable
ALTER TABLE "OnCallLayer" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "restrictions" JSONB,
ADD COLUMN     "shiftLengthHours" INTEGER;

-- CreateIndex
CREATE INDEX "LogEntry_level_timestamp_idx" ON "LogEntry"("level", "timestamp");

-- CreateIndex
CREATE INDEX "LogEntry_serviceId_level_timestamp_idx" ON "LogEntry"("serviceId", "level", "timestamp");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_status_createdAt_idx" ON "Notification"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OnCallOverride_scheduleId_start_end_idx" ON "OnCallOverride"("scheduleId", "start", "end");

-- CreateIndex
CREATE INDEX "OnCallOverride_userId_start_end_idx" ON "OnCallOverride"("userId", "start", "end");

-- CreateIndex
CREATE INDEX "sla_performance_logs_serviceId_timestamp_idx" ON "sla_performance_logs"("serviceId", "timestamp");

-- CreateIndex
CREATE INDEX "sla_performance_logs_teamId_timestamp_idx" ON "sla_performance_logs"("teamId", "timestamp");

-- CreateIndex
CREATE INDEX "sla_performance_logs_timestamp_durationMs_idx" ON "sla_performance_logs"("timestamp", "durationMs");
