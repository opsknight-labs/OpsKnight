-- Marks status page services published only because a business service on the page contains
-- them. Existing rows stay false (treated as direct selections), so nothing is removed on upgrade.
ALTER TABLE "StatusPageService" ADD COLUMN "viaBusinessService" BOOLEAN NOT NULL DEFAULT false;
