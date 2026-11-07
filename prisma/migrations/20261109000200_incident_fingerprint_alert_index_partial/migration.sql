-- Constant default: PostgreSQL stores it in the catalog, so no table rewrite on large histories.
SET lock_timeout = '2s';
SET statement_timeout = '10s';
ALTER TABLE "IncidentFingerprint" ADD COLUMN "alertIndexPartial" BOOLEAN NOT NULL DEFAULT false;
RESET statement_timeout;
RESET lock_timeout;
