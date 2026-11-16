-- Additive only: defaulted or nullable columns. No existing row is rewritten or backfilled.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "AiSettings" ADD COLUMN "spendControlsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiSettings" ADD COLUMN "backgroundAiBudgetPercent" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "AiSettings" ADD COLUMN "proactiveNotesPerServiceDaily" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "AiUsageDay" ADD COLUMN "backgroundAiTokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AiTokenReservation" ADD COLUMN "callSite" TEXT;
