ALTER TABLE "Incident"
ADD COLUMN "slaAckElapsedMs" BIGINT,
ADD COLUMN "slaResolveElapsedMs" BIGINT;

-- Capture historical lifecycle elapsed values exactly at their evaluation
-- boundary. Pause intervals are clipped, unioned, and summed once for the
-- complete backfill rather than reconstructed independently by every metric.
WITH targets AS (
  SELECT i."id", 'ack'::text AS kind, i."createdAt", i."acknowledgedAt" AS evaluation_at
  FROM "Incident" i
  WHERE i."acknowledgedAt" IS NOT NULL AND i."slaAckElapsedMs" IS NULL
  UNION ALL
  SELECT i."id", 'resolve'::text, i."createdAt", COALESCE(i."resolvedAt", i."updatedAt")
  FROM "Incident" i
  WHERE i."status" = 'RESOLVED' AND i."slaResolveElapsedMs" IS NULL
), clipped AS (
  SELECT
    t."id",
    t.kind,
    t."createdAt",
    t.evaluation_at,
    GREATEST(p."startedAt", t."createdAt") AS start_at,
    LEAST(COALESCE(p."endedAt", t.evaluation_at), t.evaluation_at) AS end_at
  FROM targets t
  JOIN "IncidentSlaPause" p
    ON p."incidentId" = t."id"
   AND p."startedAt" < t.evaluation_at
   AND COALESCE(p."endedAt", t.evaluation_at) > t."createdAt"
), marked AS (
  SELECT clipped.*,
    MAX(end_at) OVER (
      PARTITION BY "id", kind
      ORDER BY start_at, end_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_end
  FROM clipped
), numbered AS (
  SELECT marked.*,
    SUM(CASE WHEN prior_end IS NULL OR start_at > prior_end THEN 1 ELSE 0 END)
      OVER (PARTITION BY "id", kind ORDER BY start_at, end_at) AS island
  FROM marked
), islands AS (
  SELECT "id", kind, MIN(start_at) AS island_start, MAX(end_at) AS island_end
  FROM numbered
  GROUP BY "id", kind, island
), paused AS (
  SELECT "id", kind,
    SUM(EXTRACT(EPOCH FROM (island_end - island_start)) * 1000)::BIGINT AS paused_ms
  FROM islands
  GROUP BY "id", kind
), elapsed AS (
  SELECT t."id", t.kind,
    GREATEST(
      0,
      (EXTRACT(EPOCH FROM (t.evaluation_at - t."createdAt")) * 1000)::BIGINT
      - COALESCE(p.paused_ms, 0)
    ) AS elapsed_ms
  FROM targets t
  LEFT JOIN paused p ON p."id" = t."id" AND p.kind = t.kind
), captured AS (
  SELECT "id",
    MAX(elapsed_ms) FILTER (WHERE kind = 'ack') AS ack_ms,
    MAX(elapsed_ms) FILTER (WHERE kind = 'resolve') AS resolve_ms
  FROM elapsed
  GROUP BY "id"
)
UPDATE "Incident" i
SET
  "slaAckElapsedMs" = COALESCE(i."slaAckElapsedMs", captured.ack_ms),
  "slaResolveElapsedMs" = COALESCE(i."slaResolveElapsedMs", captured.resolve_ms)
FROM captured
WHERE i."id" = captured."id";
