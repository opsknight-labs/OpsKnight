-- Impact rows become intervals: a reopened incident starts a new interval instead of reopening
-- the old one, so the healthy gap is not counted as downtime. The table is new and unreleased.
ALTER TABLE "IncidentBusinessServiceImpact" ADD COLUMN "id" TEXT;
UPDATE "IncidentBusinessServiceImpact" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "IncidentBusinessServiceImpact" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "IncidentBusinessServiceImpact" DROP CONSTRAINT "IncidentBusinessServiceImpact_pkey";
ALTER TABLE "IncidentBusinessServiceImpact" ADD CONSTRAINT "IncidentBusinessServiceImpact_pkey" PRIMARY KEY ("id");

CREATE INDEX "IncidentBusinessServiceImpact_incidentId_businessServiceId_startedAt_idx"
  ON "IncidentBusinessServiceImpact"("incidentId", "businessServiceId", "startedAt");

-- At most one open interval per incident and business service.
CREATE UNIQUE INDEX "IncidentBusinessServiceImpact_open_unique"
  ON "IncidentBusinessServiceImpact"("incidentId", "businessServiceId")
  WHERE "endedAt" IS NULL;
