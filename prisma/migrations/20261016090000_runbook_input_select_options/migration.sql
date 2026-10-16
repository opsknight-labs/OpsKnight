-- SELECT inputs store their allowed values; other input types keep an empty list.
ALTER TABLE "RunbookInput" ADD COLUMN IF NOT EXISTS "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
