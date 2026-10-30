-- OpsKnight Intelligence: optional assistant personalisation. Additive; defaults keep current behaviour.
BEGIN;

ALTER TABLE "AiSettings"
  ADD COLUMN "squireAvatar" TEXT NOT NULL DEFAULT 'ICON',
  ADD COLUMN "squireLauncher" TEXT NOT NULL DEFAULT 'FLOATING',
  ADD COLUMN "squireAnimations" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AiSettings"
  ADD CONSTRAINT "AiSettings_avatar_check" CHECK ("squireAvatar" IN ('ICON', 'KNIGHT', 'OWL', 'ROBOT')),
  ADD CONSTRAINT "AiSettings_launcher_check" CHECK ("squireLauncher" IN ('FLOATING', 'SEARCH_ONLY'));

COMMIT;
