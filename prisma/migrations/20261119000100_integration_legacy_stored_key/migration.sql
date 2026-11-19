-- Integrations that exist at upgrade keep accepting, on /api/events, the exact
-- encrypted key value the old UI displayed, so live alerting does not break.
-- Rows created afterwards default to false. Adding the column with a constant
-- default is metadata-only, so existing rows are not rewritten and their
-- revision trigger does not fire.
ALTER TABLE "Integration" ADD COLUMN "legacyStoredKeyAccepted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Integration" ALTER COLUMN "legacyStoredKeyAccepted" SET DEFAULT false;
