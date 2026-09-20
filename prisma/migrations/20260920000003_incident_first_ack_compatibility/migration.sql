-- Phase A rolling-deployment compatibility. Old replicas clear slaAckElapsedMs
-- during REOPEN/UNACKNOWLEDGE; preserve the value instead of rejecting the
-- entire lifecycle transaction while mixed application versions are live.
ALTER TABLE "Incident" ADD COLUMN "slaFirstAcknowledgedAt" TIMESTAMP(3);

-- BEGIN legacy first-ACK repair
-- Old REOPEN/UNACKNOWLEDGE writers erased both ACK columns. Reconstruct the
-- lifetime fact from the earliest durable ACK event, falling back to the
-- current operational timestamp only for installations without event history.
WITH first_ack_events AS (
  SELECT e."incidentId", MIN(e."createdAt") AS acknowledged_at
  FROM "IncidentEvent" e
  WHERE e."type" = 'ACKNOWLEDGED'::"IncidentEventType"
    OR (e."type" IS NULL AND e."message" ILIKE 'Incident acknowledged%')
  GROUP BY e."incidentId"
), targets AS (
  SELECT
    i."id",
    i."createdAt",
    COALESCE(f.acknowledged_at, i."acknowledgedAt") AS evaluation_at
  FROM "Incident" i
  LEFT JOIN first_ack_events f ON f."incidentId" = i."id"
  WHERE (i."slaAckElapsedMs" IS NULL OR i."slaFirstAcknowledgedAt" IS NULL)
    AND COALESCE(f.acknowledged_at, i."acknowledgedAt") IS NOT NULL
    AND COALESCE(f.acknowledged_at, i."acknowledgedAt") >= i."createdAt"
), clipped AS (
  SELECT
    t."id",
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
      PARTITION BY "id" ORDER BY start_at, end_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_end
  FROM clipped
), numbered AS (
  SELECT marked.*,
    SUM(CASE WHEN prior_end IS NULL OR start_at > prior_end THEN 1 ELSE 0 END)
      OVER (PARTITION BY "id" ORDER BY start_at, end_at) AS island
  FROM marked
), islands AS (
  SELECT "id", MIN(start_at) AS island_start, MAX(end_at) AS island_end
  FROM numbered
  GROUP BY "id", island
), paused AS (
  SELECT "id",
    SUM(EXTRACT(EPOCH FROM (island_end - island_start)) * 1000)::BIGINT AS paused_ms
  FROM islands
  GROUP BY "id"
), repaired AS (
  SELECT
    t."id",
    t.evaluation_at,
    GREATEST(
      0,
      (EXTRACT(EPOCH FROM (t.evaluation_at - t."createdAt")) * 1000)::BIGINT
      - COALESCE(p.paused_ms, 0)
    ) AS elapsed_ms
  FROM targets t
  LEFT JOIN paused p ON p."id" = t."id"
)
UPDATE "Incident" i
SET
  "slaFirstAcknowledgedAt" = COALESCE(i."slaFirstAcknowledgedAt", repaired.evaluation_at),
  "slaAckElapsedMs" = COALESCE(i."slaAckElapsedMs", repaired.elapsed_ms)
FROM repaired
WHERE i."id" = repaired."id";
-- END legacy first-ACK repair

CREATE TABLE "IncidentSlaLegacyAckMutation" (
  "day" DATE NOT NULL,
  "count" BIGINT NOT NULL DEFAULT 0,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastIncidentId" TEXT,
  CONSTRAINT "IncidentSlaLegacyAckMutation_pkey" PRIMARY KEY ("day")
);

CREATE OR REPLACE FUNCTION opsknight_preserve_incident_first_ack_capture()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."slaAckElapsedMs" IS NULL AND NEW."slaAckElapsedMs" IS NOT NULL
    AND NEW."slaFirstAcknowledgedAt" IS NULL THEN
    NEW."slaFirstAcknowledgedAt" := COALESCE(NEW."acknowledgedAt", CURRENT_TIMESTAMP);
  END IF;

  IF OLD."slaAckElapsedMs" IS NOT NULL
    AND (NEW."slaAckElapsedMs" IS DISTINCT FROM OLD."slaAckElapsedMs"
      OR NEW."slaFirstAcknowledgedAt" IS DISTINCT FROM OLD."slaFirstAcknowledgedAt") THEN
    NEW."slaAckElapsedMs" := OLD."slaAckElapsedMs";
    NEW."slaFirstAcknowledgedAt" := OLD."slaFirstAcknowledgedAt";
    INSERT INTO "IncidentSlaLegacyAckMutation" ("day", "count", "lastSeenAt", "lastIncidentId")
    VALUES (CURRENT_DATE, 1, CURRENT_TIMESTAMP, OLD."id")
    ON CONFLICT ("day") DO UPDATE SET
      "count" = "IncidentSlaLegacyAckMutation"."count" + 1,
      "lastSeenAt" = EXCLUDED."lastSeenAt",
      "lastIncidentId" = EXCLUDED."lastIncidentId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER incident_first_ack_capture_preserved
BEFORE UPDATE OF "slaAckElapsedMs", "slaFirstAcknowledgedAt" ON "Incident"
FOR EACH ROW
EXECUTE FUNCTION opsknight_preserve_incident_first_ack_capture();
