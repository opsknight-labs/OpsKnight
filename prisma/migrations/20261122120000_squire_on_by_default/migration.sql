-- Squire is on by default (basic answers need no AI provider) and is the only avatar.
-- Saved settings rows keep the administrator's choices; only the column defaults change.
ALTER TABLE "AiSettings" ALTER COLUMN "squireEnabled" SET DEFAULT true;
ALTER TABLE "AiSettings" ALTER COLUMN "squireAnimations" SET DEFAULT true;
ALTER TABLE "AiSettings" DROP CONSTRAINT IF EXISTS "AiSettings_avatar_check";
ALTER TABLE "AiSettings" DROP COLUMN IF EXISTS "squireAvatar";
