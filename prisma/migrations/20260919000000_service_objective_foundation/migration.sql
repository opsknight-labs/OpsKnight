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
  CONSTRAINT "ServiceObjective_pkey" PRIMARY KEY ("id")
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
  CONSTRAINT "ServiceObjectiveSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceObjective_legacySlaDefinitionId_key"
  ON "ServiceObjective"("legacySlaDefinitionId");
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
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceObjectiveSnapshot"
  ADD CONSTRAINT "ServiceObjectiveSnapshot_objectiveId_fkey"
  FOREIGN KEY ("objectiveId") REFERENCES "ServiceObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only generic objectives are migrated. Rows carrying ACK/resolve targets are
-- legacy incident-SLA records and remain archived in place, read-only.
INSERT INTO "ServiceObjective" (
  "id", "serviceId", "name", "description", "metricType", "target",
  "comparator", "windowType", "windowValue", "version", "activeFrom",
  "activeTo", "legacySlaDefinitionId", "createdAt", "updatedAt"
)
SELECT
  'so_' || md5("id"),
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
  "activeTo",
  "id",
  "createdAt",
  "updatedAt"
FROM "SLADefinition"
WHERE "metricType" IN ('UPTIME', 'AVAILABILITY', 'MTTA', 'MTTR', 'LATENCY_P99')
  AND "targetAckTime" IS NULL
  AND "targetResolveTime" IS NULL
ON CONFLICT ("legacySlaDefinitionId") DO NOTHING;
