-- Additive AI governance settings; all new settings default to off or empty.
BEGIN;

ALTER TABLE "AiSettings"
  ADD COLUMN "allowedDataRegions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "embeddingsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "squireHistoryEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "squireHistoryRetentionDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "AiSettings"
  ADD CONSTRAINT "AiSettings_history_retention_check" CHECK ("squireHistoryRetentionDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "AiSettings_regions_check" CHECK (cardinality("allowedDataRegions") <= 20);

ALTER TABLE "AiProvider"
  ADD COLUMN "options" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "dataRegion" TEXT,
  ADD COLUMN "embeddingModel" TEXT;

ALTER TABLE "AiProvider"
  ADD CONSTRAINT "AiProvider_region_check" CHECK ("dataRegion" IS NULL OR "dataRegion" ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  ADD CONSTRAINT "AiProvider_embedding_model_check" CHECK ("embeddingModel" IS NULL OR char_length("embeddingModel") BETWEEN 1 AND 128),
  ADD CONSTRAINT "AiProvider_options_check" CHECK (jsonb_typeof("options") = 'object');

CREATE TABLE "AiPromptGuidance" (
    "promptId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPromptGuidance_pkey" PRIMARY KEY ("promptId"),
    CONSTRAINT "AiPromptGuidance_text_check" CHECK (char_length("text") <= 2000)
);

COMMIT;
