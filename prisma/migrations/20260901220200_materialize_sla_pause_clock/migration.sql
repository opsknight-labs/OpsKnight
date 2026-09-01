ALTER TABLE "Incident"
  ADD COLUMN "slaPausedMs" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "slaPauseStartedAt" TIMESTAMP(3);

-- Materialize existing pause history without losing the audit intervals.
UPDATE "Incident" AS incident
SET "slaPausedMs" = pause_totals."closedMs",
    "slaPauseStartedAt" = pause_totals."openStartedAt"
FROM (
  SELECT "incidentId",
    COALESCE(SUM(
      CASE WHEN "endedAt" IS NOT NULL
        THEN GREATEST(0, EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) * 1000)::BIGINT
        ELSE 0
      END
    ), 0)::BIGINT AS "closedMs",
    MIN("startedAt") FILTER (WHERE "endedAt" IS NULL) AS "openStartedAt"
  FROM "IncidentSlaPause"
  GROUP BY "incidentId"
) AS pause_totals
WHERE incident."id" = pause_totals."incidentId";

-- Existing muted incidents predate durable pause rows. Start their clock at
-- the deployment snapshot (updatedAt is the safest known lower bound).
UPDATE "Incident"
SET "slaPauseStartedAt" = "updatedAt"
WHERE "status" IN ('SNOOZED', 'SUPPRESSED')
  AND "slaPauseStartedAt" IS NULL;

INSERT INTO "IncidentSlaPause" (
  "id", "incidentId", "reason", "startedAt", "lifecycleGeneration", "createdAt", "updatedAt"
)
SELECT CONCAT('sla-migration-', "id"), "id", 'upgrade-muted-state',
  "slaPauseStartedAt", "escalationGeneration", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Incident"
WHERE "slaPauseStartedAt" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX "Incident_slaPauseStartedAt_idx" ON "Incident"("slaPauseStartedAt");
