-- CreateTable
CREATE TABLE "SlackIncidentMessage" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelId" TEXT,
    "ts" TEXT,
    "workspaceId" TEXT,
    "lastEventType" TEXT,
    "lastEventKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlackIncidentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlackIncidentMessage_incidentId_channel_key" ON "SlackIncidentMessage"("incidentId", "channel");

-- AddForeignKey
ALTER TABLE "SlackIncidentMessage" ADD CONSTRAINT "SlackIncidentMessage_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
