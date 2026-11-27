ALTER TABLE "SlackDestination" ADD COLUMN IF NOT EXISTS "priorities" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SlackDestination" ADD COLUMN IF NOT EXISTS "urgencies" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ChatOpsConfig" ADD COLUMN IF NOT EXISTS "warRoomInviteOnCall" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "SlackOnCallSync" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "usergroupId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SlackOnCallSync_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SlackOnCallSync_scheduleId_key" ON "SlackOnCallSync"("scheduleId");
CREATE INDEX IF NOT EXISTS "SlackOnCallSync_enabled_idx" ON "SlackOnCallSync"("enabled");
ALTER TABLE "SlackOnCallSync" ADD CONSTRAINT "SlackOnCallSync_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OnCallSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
