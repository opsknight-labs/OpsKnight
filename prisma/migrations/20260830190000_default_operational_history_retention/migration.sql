-- Keep new installations' audit and incident-event history for one year by default.
-- Existing tenant settings are deliberately left unchanged: administrators may have
-- selected a stricter or longer compliance retention period.
ALTER TABLE "SystemSettings"
  ALTER COLUMN "logRetentionDays" SET DEFAULT 365;
