-- Singleton settings table: atomically admit the new mascot while preserving existing choices.
ALTER TABLE "AiSettings"
  DROP CONSTRAINT "AiSettings_avatar_check",
  ADD CONSTRAINT "AiSettings_avatar_check" CHECK ("squireAvatar" IN ('SQUIRE', 'ICON', 'KNIGHT', 'OWL', 'ROBOT'));
