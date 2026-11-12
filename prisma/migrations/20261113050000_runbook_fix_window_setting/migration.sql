-- Additive only: one constant-default column on the settings singleton.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "runbookFixWindowMinutes" INTEGER NOT NULL DEFAULT 120;

-- NOT VALID takes no table scan; the singleton row already holds the default.
ALTER TABLE "IntelligenceSettings"
  ADD CONSTRAINT "IntelligenceSettings_runbook_fix_window_check"
  CHECK ("runbookFixWindowMinutes" BETWEEN 5 AND 1440) NOT VALID;
