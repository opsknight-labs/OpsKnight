-- AlterTable: Add ChatOps War-Room fields to Incident
ALTER TABLE "Incident" ADD COLUMN "slackChannelId" TEXT;
ALTER TABLE "Incident" ADD COLUMN "slackChannelName" TEXT;
ALTER TABLE "Incident" ADD COLUMN "warRoomUrl" TEXT;

-- AlterTable: Add ChatOps overrides to Service
ALTER TABLE "Service" ADD COLUMN "autoCreateWarRoom" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Service" ADD COLUMN "warRoomVideoBridge" TEXT;
ALTER TABLE "Service" ADD COLUMN "warRoomCustomBridgeUrl" TEXT;

-- CreateTable: ChatOpsConfig (Global Configuration)
CREATE TABLE "ChatOpsConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoCreateOnUrgency" TEXT[] DEFAULT ARRAY['HIGH']::TEXT[],
    "autoCreateOnPriority" TEXT[] DEFAULT ARRAY['P1', 'P2']::TEXT[],
    "channelPrefix" TEXT NOT NULL DEFAULT 'inc',
    "archiveOnResolve" BOOLEAN NOT NULL DEFAULT true,
    "defaultVideoBridge" TEXT NOT NULL DEFAULT 'JITSI',
    "customBridgeUrlTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatOpsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: War-Room channel lookup (for slash command → incident resolution)
CREATE INDEX "idx_incident_war_room_channel" ON "Incident"("slackChannelId");

-- CreateIndex: ChatOpsConfig unique
CREATE UNIQUE INDEX "ChatOpsConfig_id_key" ON "ChatOpsConfig"("id");
