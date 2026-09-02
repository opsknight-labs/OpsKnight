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

-- Reconstruct distinct affected-incident counts for every existing rollup.
-- These are derived rows, but rebuilding them here avoids a window where old
-- historical rates read as zero while the bounded scheduler catches up.
WITH reconstructed AS (
  SELECT
    r."id",
    COUNT(DISTINCT e."incidentId") FILTER (
      WHERE e."type" = 'ESCALATED'::"IncidentEventType"
         OR (e."type" IS NULL AND e."message" ILIKE '%escalated to%')
    )::INTEGER AS escalated,
    COUNT(DISTINCT e."incidentId") FILTER (
      WHERE e."type" = 'REOPENED'::"IncidentEventType"
         OR (e."type" IS NULL AND e."message" ILIKE '%reopen%'
             AND e."message" NOT ILIKE '%do not reopen%')
    )::INTEGER AS reopened,
    COUNT(DISTINCT e."incidentId") FILTER (
      WHERE e."type" = 'AUTO_RESOLVED'::"IncidentEventType"
         OR (e."type" IS NULL AND e."message" ILIKE '%auto-resolved%'
             AND e."message" NOT ILIKE '%not auto-resolved%')
    )::INTEGER AS auto_resolved
  FROM "IncidentMetricRollup" r
  LEFT JOIN "Incident" i
    ON i."createdAt" >= r."date"
    AND i."createdAt" < r."date" + CASE r."granularity"
      WHEN 'weekly' THEN INTERVAL '7 days'
      WHEN 'monthly' THEN INTERVAL '1 month'
      ELSE INTERVAL '1 day'
    END
    AND (r."serviceId" IS NULL OR i."serviceId" = r."serviceId")
    AND (r."teamId" IS NULL OR i."teamId" = r."teamId")
  LEFT JOIN "IncidentEvent" e ON e."incidentId" = i."id"
  GROUP BY r."id"
)
UPDATE "IncidentMetricRollup" r
SET "escalatedIncidentCount" = reconstructed.escalated,
    "reopenedIncidentCount" = reconstructed.reopened,
    "autoResolvedIncidentCount" = reconstructed.auto_resolved
FROM reconstructed
WHERE reconstructed."id" = r."id";
