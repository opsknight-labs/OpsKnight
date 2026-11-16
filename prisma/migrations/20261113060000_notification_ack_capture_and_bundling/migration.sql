-- Additive only: nullable columns on "Notification" and one defaulted boolean on "User" (a constant default
-- is a catalogue-only change). No existing row is rewritten or backfilled, and no index is added: the noise
-- rollups read each day through the existing ("createdAt", "id") index.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "Notification" ADD COLUMN "ackedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "ackedVia" TEXT;
ALTER TABLE "Notification" ADD COLUMN "escalationStepIndex" INTEGER;
ALTER TABLE "User" ADD COLUMN "bundleLowUrgencyPages" BOOLEAN NOT NULL DEFAULT false;
