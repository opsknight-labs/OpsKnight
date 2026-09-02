ALTER TABLE "IncidentMetricRollup"
  ADD COLUMN "escalationEventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalatedIncidentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reopenEventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reopenedIncidentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoResolveEventCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoResolvedIncidentCount" INTEGER NOT NULL DEFAULT 0;

-- Legacy rows only carried event counts. Preserve throughput exactly while
-- marking affected-incident counts conservatively for regeneration/backfill.
UPDATE "IncidentMetricRollup"
SET "escalationEventCount" = "escalationCount",
    "reopenEventCount" = "reopenCount",
    "autoResolveEventCount" = "autoResolveCount";
