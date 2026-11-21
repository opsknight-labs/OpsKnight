-- M5.4: compact page context (top similar incident, likely change, best runbook) precomputed by the
-- intelligence lane onto the incident row, so page notifications carry it without a dispatch-path query.
-- One nullable column and one defaulted switch, default off. No row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "Incident" ADD COLUMN "pageContext" JSONB;
ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "pageContextEnabled" BOOLEAN NOT NULL DEFAULT false;
