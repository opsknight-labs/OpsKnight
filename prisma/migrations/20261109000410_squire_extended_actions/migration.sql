-- Additive only: one defaulted boolean (metadata-only on PostgreSQL 11+, no table rewrite or backfill).
-- Extended assistant actions stay off until an administrator turns them on.
SET lock_timeout = '2s';
SET statement_timeout = '10s';
ALTER TABLE "AiSettings" ADD COLUMN "squireExtendedActions" BOOLEAN NOT NULL DEFAULT false;
RESET statement_timeout;
RESET lock_timeout;
