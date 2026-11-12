-- Nullable column only: metadata change with no table rewrite or backfill.
SET lock_timeout = '2s';
SET statement_timeout = '10s';
ALTER TABLE "IntelligenceWorkItem" ADD COLUMN "quarantinedAt" TIMESTAMP(3);
RESET statement_timeout;
RESET lock_timeout;
