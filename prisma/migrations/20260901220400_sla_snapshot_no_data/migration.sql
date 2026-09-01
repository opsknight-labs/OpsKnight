ALTER TABLE "SLASnapshot"
  ADD COLUMN "evaluatedAckCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "evaluatedResolveCount" INTEGER NOT NULL DEFAULT 0,
  ALTER COLUMN "complianceScore" DROP NOT NULL;

-- Existing snapshots did not preserve denominators. Keep their score for
-- compatibility but mark evaluated counts unknown (zero) until regenerated.
UPDATE "SLASnapshot" SET "complianceScore" = NULL;
