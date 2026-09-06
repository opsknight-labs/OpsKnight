-- SLA Tier-2 hardening migration.
--
-- Rolling-safe contract: every change in this migration is additive and
-- safe for an old application pod to run against. No columns dropped,
-- no NOT NULL added to existing columns, no breaking enum changes.
--
-- After this migration is applied:
--   - New code (post-deploy) can WRITE typed IncidentEvents and per-
--     priority rollup rows.
--   - Old code (pre-deploy, still running during rollout) keeps writing
--     untyped IncidentEvents and aggregate-only rollups; readers fall
--     back to ILIKE / aggregate-only data.
--
-- A FOLLOW-UP release (after backfill verification) will:
--   - Backfill `IncidentEvent.type` from `message` ILIKE patterns.
--   - Backfill `IncidentMetricRollupByPriority` from raw incidents.
--   - Flip readers to typed-only.
--   - Optionally make `IncidentEvent.type` NOT NULL.


-- ------------------------------------------------------------------
-- 1) IncidentEventType enum + nullable IncidentEvent.type column
-- ------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "IncidentEventType" AS ENUM (
        'ACKNOWLEDGED',
        'ESCALATED',
        'REOPENED',
        'AUTO_RESOLVED',
        'MANUAL_RESOLVED',
        'COMMENT',
        'STATUS_CHANGE',
        'ASSIGNMENT',
        'LEGACY_OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "IncidentEvent"
    ADD COLUMN IF NOT EXISTS "type" "IncidentEventType";

-- Type lookup index (rolling-safe: not used until readers flip).
CREATE INDEX IF NOT EXISTS "idx_event_type"
    ON "IncidentEvent" ("incidentId", "type");


-- ------------------------------------------------------------------
-- 2) Tenant-level business-hours timezone
-- ------------------------------------------------------------------
ALTER TABLE "SystemSettings"
    ADD COLUMN IF NOT EXISTS "businessHoursTimeZone" TEXT NOT NULL DEFAULT 'UTC';


-- ------------------------------------------------------------------
-- 3) Per-priority lifecycle sums on IncidentMetricRollup (side table)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "IncidentMetricRollupByPriority" (
    "id"                 TEXT          NOT NULL,
    "rollupId"           TEXT          NOT NULL,
    "priority"           TEXT          NOT NULL,
    "incidents"          INTEGER       NOT NULL DEFAULT 0,
    "mttaSum"            BIGINT        NOT NULL DEFAULT 0,
    "mttaCount"          INTEGER       NOT NULL DEFAULT 0,
    "mttrSum"            BIGINT        NOT NULL DEFAULT 0,
    "mttrCount"          INTEGER       NOT NULL DEFAULT 0,
    "ackSlaMet"          INTEGER       NOT NULL DEFAULT 0,
    "ackSlaBreached"     INTEGER       NOT NULL DEFAULT 0,
    "resolveSlaMet"      INTEGER       NOT NULL DEFAULT 0,
    "resolveSlaBreached" INTEGER       NOT NULL DEFAULT 0,

    CONSTRAINT "IncidentMetricRollupByPriority_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IncidentMetricRollupByPriority_rollupId_priority_key"
    ON "IncidentMetricRollupByPriority" ("rollupId", "priority");
CREATE INDEX IF NOT EXISTS "IncidentMetricRollupByPriority_priority_idx"
    ON "IncidentMetricRollupByPriority" ("priority");

ALTER TABLE "IncidentMetricRollupByPriority"
    ADD CONSTRAINT "IncidentMetricRollupByPriority_rollupId_fkey"
    FOREIGN KEY ("rollupId")
    REFERENCES "IncidentMetricRollup"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;


-- ------------------------------------------------------------------
-- 4) Partial unique indexes on IncidentMetricRollup (close NULL holes)
-- ------------------------------------------------------------------
-- The existing `@@unique([date, granularity, serviceId, teamId])`
-- constraint doesn't enforce uniqueness when serviceId or teamId is NULL
-- (Postgres treats NULLs as distinct). That lets concurrent rollup-gen
-- jobs insert duplicate rollups for the "global", "service-only", or
-- "team-only" variants, causing double-counting in downstream queries.
-- These partial unique indexes cover each NULL combination.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_rollup_unique_global"
    ON "IncidentMetricRollup" ("date", "granularity")
    WHERE "serviceId" IS NULL AND "teamId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_rollup_unique_service_only"
    ON "IncidentMetricRollup" ("date", "granularity", "serviceId")
    WHERE "serviceId" IS NOT NULL AND "teamId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_rollup_unique_team_only"
    ON "IncidentMetricRollup" ("date", "granularity", "teamId")
    WHERE "serviceId" IS NULL AND "teamId" IS NOT NULL;

-- The existing four-column @@unique covers the (serviceId IS NOT NULL
-- AND teamId IS NOT NULL) case; no extra partial index needed there.
