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

CREATE INDEX "Incident_slaPauseStartedAt_idx" ON "Incident"("slaPauseStartedAt");
