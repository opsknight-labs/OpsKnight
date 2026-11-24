-- Squire: personal memory and settings, on-call heads-ups, organisation documentation sources, channel
-- back-off, and every incident a multi-step plan touched.
ALTER TYPE "KnowledgeSourceKind" ADD VALUE IF NOT EXISTS 'DOCUMENT';

ALTER TABLE "SquireActionReceipt" ADD COLUMN "incidentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "SquireUserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "textEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SquireUserMemory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_squire_user_memory_owner" ON "SquireUserMemory"("userId", "createdAt");
ALTER TABLE "SquireUserMemory" ADD CONSTRAINT "SquireUserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SquireUserSettings" (
    "userId" TEXT NOT NULL,
    "headsUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "headsUpLeadMinutes" INTEGER NOT NULL DEFAULT 60,
    "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SquireUserSettings_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "SquireUserSettings" ADD CONSTRAINT "SquireUserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SquireHeadsUp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftKey" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SquireHeadsUp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_squire_heads_up_shift" ON "SquireHeadsUp"("userId", "shiftKey");
CREATE INDEX "idx_squire_heads_up_retention" ON "SquireHeadsUp"("deliveredAt");
ALTER TABLE "SquireHeadsUp" ADD CONSTRAINT "SquireHeadsUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KnowledgeDocSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ref" TEXT,
    "path" TEXT,
    "tokenEncrypted" TEXT,
    "teamId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeDocSource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_knowledge_doc_source_sync" ON "KnowledgeDocSource"("enabled", "lastSyncedAt");

CREATE TABLE "SquireChannelBackoff" (
    "key" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SquireChannelBackoff_pkey" PRIMARY KEY ("key")
);
