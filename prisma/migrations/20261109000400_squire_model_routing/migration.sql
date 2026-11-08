-- Additive only: one nullable column and one defaulted boolean on the single AI settings row.
-- Both default to the previous behaviour (no routing, investigation off). No existing row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "capabilityRouting" JSONB;
ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "squireInvestigationEnabled" BOOLEAN NOT NULL DEFAULT false;

RESET statement_timeout;
RESET lock_timeout;
