-- Squire: channel messages edited in place, background answers, and feedback that can be learned from.
ALTER TABLE "SquireFeedback" ADD COLUMN "incidentId" TEXT;
ALTER TABLE "SquireFeedback" ADD COLUMN "serviceId" TEXT;
ALTER TABLE "SquireFeedback" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'NEW';
CREATE INDEX "idx_squire_feedback_review" ON "SquireFeedback"("reviewStatus", "createdAt");

CREATE TABLE "SquireChannelMessage" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquireChannelMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_squire_channel_message" ON "SquireChannelMessage"("incidentId", "provider", "kind");
ALTER TABLE "SquireChannelMessage" ADD CONSTRAINT "SquireChannelMessage_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SquireBackgroundTurn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "incidentId" TEXT,
    "requestEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "resultConversationId" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquireBackgroundTurn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_squire_background_status" ON "SquireBackgroundTurn"("status", "createdAt");
CREATE INDEX "idx_squire_background_owner" ON "SquireBackgroundTurn"("userId", "createdAt");
ALTER TABLE "SquireBackgroundTurn" ADD CONSTRAINT "SquireBackgroundTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
