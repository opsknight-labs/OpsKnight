-- Nullable columns only: metadata change with no table rewrite or backfill in this migration.
SET lock_timeout = '2s';
SET statement_timeout = '10s';
ALTER TABLE "Alert"
  ADD COLUMN "severity" VARCHAR(16),
  ADD COLUMN "resourceKey" VARCHAR(256),
  ADD COLUMN "labels" JSONB,
  ADD COLUMN "fingerprintHash" VARCHAR(64),
  ADD COLUMN "updatedAt" TIMESTAMP(3);
RESET statement_timeout;
RESET lock_timeout;
