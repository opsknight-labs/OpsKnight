-- Additive only: a nullable column and three small new tables. No existing row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "SquireConversation" ADD COLUMN "state" JSONB;

CREATE TABLE "SquireCheckTemplate" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "checks" TEXT[] NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 100,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SquireCheckTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_squire_check_template_enabled" ON "SquireCheckTemplate"("enabled", "position");

CREATE TABLE "SquireFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "mode" TEXT NOT NULL,
  "intent" TEXT,
  "rating" TEXT NOT NULL,
  "reason" TEXT,
  "questionHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SquireFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_squire_feedback_recent" ON "SquireFeedback"("createdAt");
CREATE INDEX "idx_squire_feedback_owner" ON "SquireFeedback"("userId", "createdAt");
ALTER TABLE "SquireFeedback" ADD CONSTRAINT "SquireFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiProviderBreaker" (
  "providerId" TEXT NOT NULL,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "openUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiProviderBreaker_pkey" PRIMARY KEY ("providerId")
);

RESET statement_timeout;
RESET lock_timeout;
