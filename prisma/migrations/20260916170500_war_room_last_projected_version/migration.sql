-- Make terminal projection subordinate to close lifecycle.
-- projectionVersion is queued-at; lastProjectedVersion advances only on successful provider apply.
ALTER TABLE "IncidentWarRoom" ADD COLUMN IF NOT EXISTS "lastProjectedVersion" INTEGER NOT NULL DEFAULT 0;
