-- Incident response SLA remains owned by IncidentSlaPolicy and the frozen
-- Incident contract. These additive tables replace the generic-objective use
-- of SLADefinition without rewriting or deleting legacy history.
CREATE TYPE "ServiceObjectiveMetric" AS ENUM (
  'UPTIME',
  'AVAILABILITY',
  'MTTA',
  'MTTR',
  'LATENCY_P99',
  'ERROR_RATE'
);

CREATE TYPE "ObjectiveComparator" AS ENUM (
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN_OR_EQUAL'
);

CREATE TYPE "ObjectiveWindow" AS ENUM (
  'SEVEN_DAYS',
  'THIRTY_DAYS',
  'NINETY_DAYS',
  'QUARTERLY',
  'YEARLY',
  'ROLLING_DAYS'
);

CREATE TYPE "ObjectiveDataState" AS ENUM ('AVAILABLE', 'NO_DATA', 'UNAVAILABLE');

CREATE TABLE "ServiceObjective" (
  "id" TEXT NOT NULL,
  "lineageId" TEXT NOT NULL,
  "serviceId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "metricType" "ServiceObjectiveMetric" NOT NULL,
  "target" DOUBLE PRECISION NOT NULL,
  "comparator" "ObjectiveComparator" NOT NULL,
  "windowType" "ObjectiveWindow" NOT NULL,
  "windowValue" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activeTo" TIMESTAMP(3),
  "legacySlaDefinitionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceObjective_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceObjective_version_check" CHECK ("version" > 0),
  CONSTRAINT "ServiceObjective_target_check" CHECK ("target" >= 0),
  CONSTRAINT "ServiceObjective_active_range_check" CHECK ("activeTo" IS NULL OR "activeTo" >= "activeFrom"),
  CONSTRAINT "ServiceObjective_window_check" CHECK (
    ("windowType" = 'ROLLING_DAYS' AND "windowValue" IS NOT NULL AND "windowValue" > 0)
    OR ("windowType" <> 'ROLLING_DAYS')
  ),
  CONSTRAINT "ServiceObjective_percentage_target_check" CHECK (
    "metricType" NOT IN ('UPTIME', 'AVAILABILITY') OR "target" <= 100
  )
);

CREATE TABLE "ServiceObjectiveSnapshot" (
  "id" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "value" DOUBLE PRECISION,
  "numerator" BIGINT,
  "denominator" BIGINT,
  "sampleCount" BIGINT,
  "target" DOUBLE PRECISION NOT NULL,
  "breached" BOOLEAN,
  "dataState" "ObjectiveDataState" NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceObjectiveSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceObjectiveSnapshot_period_check" CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "ServiceObjectiveSnapshot_sample_count_check" CHECK ("sampleCount" IS NULL OR "sampleCount" >= 0),
  CONSTRAINT "ServiceObjectiveSnapshot_numerator_check" CHECK ("numerator" IS NULL OR "numerator" >= 0),
  CONSTRAINT "ServiceObjectiveSnapshot_denominator_check" CHECK ("denominator" IS NULL OR "denominator" >= 0)
);

CREATE INDEX "ServiceObjective_lineageId_version_idx"
  ON "ServiceObjective"("lineageId", "version");
CREATE INDEX "ServiceObjective_legacySlaDefinitionId_idx"
  ON "ServiceObjective"("legacySlaDefinitionId");
CREATE UNIQUE INDEX "ServiceObjective_one_active_lineage_idx"
  ON "ServiceObjective"("lineageId") WHERE "activeTo" IS NULL;
CREATE UNIQUE INDEX "ServiceObjective_lineageId_version_key"
  ON "ServiceObjective"("lineageId", "version");
CREATE UNIQUE INDEX "ServiceObjective_one_active_service_metric_idx"
  ON "ServiceObjective"("serviceId", "metricType")
  WHERE "activeTo" IS NULL AND "serviceId" IS NOT NULL;
CREATE UNIQUE INDEX "ServiceObjective_one_active_workspace_metric_idx"
  ON "ServiceObjective"("metricType")
  WHERE "activeTo" IS NULL AND "serviceId" IS NULL;
CREATE INDEX "ServiceObjective_serviceId_metricType_activeTo_idx"
  ON "ServiceObjective"("serviceId", "metricType", "activeTo");
CREATE INDEX "ServiceObjective_activeFrom_activeTo_idx"
  ON "ServiceObjective"("activeFrom", "activeTo");
CREATE UNIQUE INDEX "ServiceObjectiveSnapshot_objectiveId_periodStart_periodEnd_key"
  ON "ServiceObjectiveSnapshot"("objectiveId", "periodStart", "periodEnd");
CREATE INDEX "ServiceObjectiveSnapshot_objectiveId_periodEnd_idx"
  ON "ServiceObjectiveSnapshot"("objectiveId", "periodEnd");

ALTER TABLE "ServiceObjective"
  ADD CONSTRAINT "ServiceObjective_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceObjectiveSnapshot"
  ADD CONSTRAINT "ServiceObjectiveSnapshot_objectiveId_fkey"
  FOREIGN KEY ("objectiveId") REFERENCES "ServiceObjective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cron_scheduler_state"
  ADD COLUMN "lastObjectiveSnapshotAt" TIMESTAMP(3),
  ADD COLUMN "lastObjectiveSnapshotSuccessAt" TIMESTAMP(3),
  ADD COLUMN "lastObjectiveSnapshotDurationMs" INTEGER,
  ADD COLUMN "lastObjectiveSnapshotFailed" INTEGER NOT NULL DEFAULT 0;

-- Only generic objectives are migrated. Rows carrying ACK/resolve targets are
-- legacy incident-SLA records and remain archived in place, read-only.
INSERT INTO "ServiceObjective" (
  "id", "lineageId", "serviceId", "name", "description", "metricType", "target",
  "comparator", "windowType", "windowValue", "version", "activeFrom",
  "activeTo", "legacySlaDefinitionId", "createdAt", "updatedAt"
)
WITH supported AS (
  SELECT *,
    SUM(CASE WHEN "version" = 1 THEN 1 ELSE 0 END) OVER (
      PARTITION BY "serviceId", "metricType"
      ORDER BY "activeFrom", "id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS chain_number,
    LEAD("activeFrom") OVER (
      PARTITION BY "serviceId", "metricType"
      ORDER BY "activeFrom", "id"
    ) AS next_active_from
  FROM "SLADefinition"
  WHERE "metricType" IN ('UPTIME', 'AVAILABILITY', 'MTTA', 'MTTR')
    AND "targetAckTime" IS NULL
    AND "targetResolveTime" IS NULL
), classified AS (
  SELECT *, GREATEST(chain_number, 1) AS effective_chain_number
  FROM supported
)
SELECT
  'so_' || md5("id"),
  'so_legacy_' || md5(
    COALESCE("serviceId", '__workspace__') || ':' || "metricType" || ':' || effective_chain_number
  ),
  "serviceId",
  "name",
  "description",
  "metricType"::"ServiceObjectiveMetric",
  "target",
  CASE
    WHEN "metricType" IN ('UPTIME', 'AVAILABILITY')
      THEN 'GREATER_THAN_OR_EQUAL'::"ObjectiveComparator"
    ELSE 'LESS_THAN_OR_EQUAL'::"ObjectiveComparator"
  END,
  CASE "window"
    WHEN '7d' THEN 'SEVEN_DAYS'::"ObjectiveWindow"
    WHEN '30d' THEN 'THIRTY_DAYS'::"ObjectiveWindow"
    WHEN '90d' THEN 'NINETY_DAYS'::"ObjectiveWindow"
    WHEN 'quarterly' THEN 'QUARTERLY'::"ObjectiveWindow"
    WHEN 'yearly' THEN 'YEARLY'::"ObjectiveWindow"
    ELSE 'ROLLING_DAYS'::"ObjectiveWindow"
  END,
  CASE
    WHEN "window" ~ '^[0-9]+d$' THEN regexp_replace("window", 'd$', '')::INTEGER
    ELSE NULL
  END,
  "version",
  "activeFrom",
  COALESCE("activeTo", next_active_from),
  "id",
  "createdAt",
  "updatedAt"
FROM classified
ON CONFLICT ("id") DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_service_objective_revision_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ServiceObjective revisions are immutable and cannot be deleted';
  END IF;
  IF NEW."lineageId" IS DISTINCT FROM OLD."lineageId"
    OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."metricType" IS DISTINCT FROM OLD."metricType"
    OR NEW."target" IS DISTINCT FROM OLD."target"
    OR NEW."comparator" IS DISTINCT FROM OLD."comparator"
    OR NEW."windowType" IS DISTINCT FROM OLD."windowType"
    OR NEW."windowValue" IS DISTINCT FROM OLD."windowValue"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."activeFrom" IS DISTINCT FROM OLD."activeFrom"
    OR NEW."legacySlaDefinitionId" IS DISTINCT FROM OLD."legacySlaDefinitionId"
    OR OLD."activeTo" IS NOT NULL
    OR NEW."activeTo" IS NULL
  THEN
    RAISE EXCEPTION 'ServiceObjective revisions are immutable; only retirement is allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ServiceObjective_immutable_revision"
BEFORE UPDATE OR DELETE ON "ServiceObjective"
FOR EACH ROW EXECUTE FUNCTION prevent_service_objective_revision_mutation();
