-- The embedding allocation is part of the existing global daily allowance, not extra spend.
ALTER TABLE "AiSettings" ADD COLUMN "backgroundEmbeddingBudgetPercent" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_backgroundEmbeddingBudgetPercent_check"
  CHECK ("backgroundEmbeddingBudgetPercent" BETWEEN 0 AND 80);
ALTER TABLE "AiUsageDay" ADD COLUMN "backgroundEmbeddingTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageDay" ADD CONSTRAINT "AiUsageDay_backgroundEmbeddingTokens_check"
  CHECK ("backgroundEmbeddingTokens" >= 0);
-- Older aggregate receipts cannot distinguish embedding from interactive calls. Charge existing
-- usage conservatively to today's sub-limit so an upgrade cannot grant a second backfill allowance.
-- Global/personal accounting is unchanged; the conservative attribution expires at midnight UTC.
UPDATE "AiUsageDay" SET "backgroundEmbeddingTokens" = "inputTokens" + "outputTokens"
  WHERE day = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD');
