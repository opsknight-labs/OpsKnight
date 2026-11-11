-- Small operations helpers (Workstream J7): one defaulted switch, default off. No existing row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "opsHelpersEnabled" BOOLEAN NOT NULL DEFAULT false;
