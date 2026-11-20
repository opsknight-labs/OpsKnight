-- Basic-mode dialogue state shared across replicas when no conversation is saved. New table only; expand-only.
CREATE TABLE IF NOT EXISTS "SquireDialogueState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "stateEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquireDialogueState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SquireDialogueState_userId_scopeKey_key" ON "SquireDialogueState"("userId", "scopeKey");

CREATE INDEX IF NOT EXISTS "idx_squire_dialogue_state_expiry" ON "SquireDialogueState"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "SquireDialogueState" ADD CONSTRAINT "SquireDialogueState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
