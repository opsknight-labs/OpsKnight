-- AlterTable: record when a war-room channel was archived. The channel id is
-- deliberately retained so the incident keeps its history; this flag is what
-- distinguishes "has a live war-room" from "had one".
ALTER TABLE "Incident" ADD COLUMN "warRoomArchivedAt" TIMESTAMP(3);

-- CreateTable: one row per Slack message captured into an incident by an emoji
-- pin, so pinning is idempotent instead of appending a duplicate note each time.
CREATE TABLE "SlackPinnedMessage" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageTs" TEXT NOT NULL,
    "pinnedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackPinnedMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlackPinnedMessage_channelId_messageTs_key" ON "SlackPinnedMessage"("channelId", "messageTs");
CREATE INDEX "SlackPinnedMessage_incidentId_idx" ON "SlackPinnedMessage"("incidentId");

ALTER TABLE "SlackPinnedMessage" ADD CONSTRAINT "SlackPinnedMessage_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: incidents whose channel was archived before this column existed are
-- indistinguishable from live war-rooms. Resolved incidents with a channel are
-- the archivable set, so stamp them from resolvedAt.
UPDATE "Incident"
SET "warRoomArchivedAt" = "resolvedAt"
WHERE "slackChannelId" IS NOT NULL AND "status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL;
