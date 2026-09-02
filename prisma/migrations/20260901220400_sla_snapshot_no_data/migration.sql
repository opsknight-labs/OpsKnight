ALTER TABLE "SLASnapshot"
  ADD COLUMN "evaluatedAckCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "evaluatedResolveCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "denominatorUnknown" BOOLEAN NOT NULL DEFAULT FALSE,
  ALTER COLUMN "complianceScore" DROP NOT NULL;

-- Existing scores remain visible for compatibility but are explicitly marked
-- as legacy/partial until the scheduler regenerates canonical denominators.
UPDATE "SLASnapshot" SET "denominatorUnknown" = TRUE;
