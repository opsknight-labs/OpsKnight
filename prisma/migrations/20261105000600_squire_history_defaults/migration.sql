-- Existing explicit settings are preserved; new installations save private chats for 90 days.
ALTER TABLE "AiSettings" ALTER COLUMN "squireHistoryEnabled" SET DEFAULT true;
ALTER TABLE "AiSettings" ALTER COLUMN "squireHistoryRetentionDays" SET DEFAULT 90;
ALTER TABLE "AiSettings" ALTER COLUMN "squireAvatar" SET DEFAULT 'SQUIRE';
