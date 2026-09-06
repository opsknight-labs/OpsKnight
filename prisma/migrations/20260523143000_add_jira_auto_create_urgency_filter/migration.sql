-- Additive, rolling-safe service-level filter for Jira incident auto-creation.
-- Empty array preserves the prior behavior: when auto-create is enabled, all
-- incident urgencies are eligible until a service explicitly narrows it.
ALTER TABLE "JiraServiceMapping"
  ADD COLUMN "autoCreateIncidentUrgencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
