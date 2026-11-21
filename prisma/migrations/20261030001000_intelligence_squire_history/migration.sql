-- OpsKnight Intelligence: opt-in saved assistant conversations. Encrypted, owner-only, bounded. Additive.
BEGIN;

CREATE TABLE "SquireConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titleEncrypted" TEXT NOT NULL,
    "incidentId" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquireConversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SquireConversation_message_count_check" CHECK ("messageCount" BETWEEN 0 AND 200)
);

CREATE TABLE "SquireMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquireMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SquireMessage_role_check" CHECK ("role" IN ('user', 'assistant'))
);

CREATE INDEX "idx_squire_conversation_owner_recent" ON "SquireConversation"("userId", "updatedAt" DESC);

CREATE INDEX "idx_squire_conversation_retention" ON "SquireConversation"("updatedAt");

CREATE INDEX "idx_squire_message_conversation" ON "SquireMessage"("conversationId", "createdAt");

ALTER TABLE "SquireConversation" ADD CONSTRAINT "SquireConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SquireMessage" ADD CONSTRAINT "SquireMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SquireConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
