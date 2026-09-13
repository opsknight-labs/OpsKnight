-- Durable announcement notification policy + generation fencing.
-- Existing announcements fail closed to NONE unless durable legacy state proves
-- that subscriber notification was intended.
CREATE TYPE "StatusPageAnnouncementNotificationTiming" AS ENUM ('NONE', 'ON_PUBLISH', 'AT_START');

ALTER TABLE "StatusPageAnnouncement"
  ADD COLUMN "notificationTiming" "StatusPageAnnouncementNotificationTiming" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "notificationGeneration" INTEGER NOT NULL DEFAULT 0;

-- Recover legacy timing from durable fan-out state where possible.
-- Precedence is intentionally ON_PUBLISH when publishAt=startDate=scheduledAt:
-- that matches the historical create-flow default and removes an otherwise
-- mathematically ambiguous upgrade decision.
--
-- A legacy materialized fan-out used announcement.updatedAt.toISOString() as
-- its event key. A matching revision proves its queued content still describes
-- the current announcement; that campaign is therefore treated as the
-- historical ON_PUBLISH default. Stale materialized content is handled below.
UPDATE "StatusPageAnnouncement" AS a
SET "notificationTiming" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "BackgroundJob" AS j
    WHERE j."type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
      AND j."status" IN ('PENDING', 'PROCESSING')
      AND j."payload"->>'announcementId' = a."id"
      AND j."payload"->>'statusPageId' = a."statusPageId"
      AND j."scheduledAt" = a."publishAt"
  ) THEN 'ON_PUBLISH'::"StatusPageAnnouncementNotificationTiming"
  WHEN EXISTS (
    SELECT 1
    FROM "BackgroundJob" AS j
    WHERE j."type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
      AND j."status" IN ('PENDING', 'PROCESSING')
      AND j."payload"->>'announcementId' = a."id"
      AND j."payload"->>'statusPageId' = a."statusPageId"
      AND j."scheduledAt" = a."startDate"
  ) THEN 'AT_START'::"StatusPageAnnouncementNotificationTiming"
  WHEN EXISTS (
    SELECT 1
    FROM "NotificationFanout" AS f
    WHERE f."sourceType" = 'STATUS_PAGE_ANNOUNCEMENT'
      AND f."sourceId" = a."id"
      AND f."statusPageId" = a."statusPageId"
      AND CASE
        WHEN f."eventKey" ~ '^\d{4}-\d{2}-\d{2}T'
          THEN f."eventKey"::timestamptz = a."updatedAt"
        ELSE FALSE
      END
  ) THEN 'ON_PUBLISH'::"StatusPageAnnouncementNotificationTiming"
  ELSE 'NONE'::"StatusPageAnnouncementNotificationTiming"
END;

-- Fence legacy in-flight jobs into generation 0 so the upgraded worker can
-- validate them instead of treating a missing generation as current forever.
UPDATE "BackgroundJob" AS j
SET "payload" = COALESCE(j."payload", '{}'::jsonb) || jsonb_build_object('notificationGeneration', 0)
FROM "StatusPageAnnouncement" AS a
WHERE j."type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
  AND j."status" IN ('PENDING', 'PROCESSING')
  AND j."payload"->>'announcementId' = a."id"
  AND j."payload"->>'statusPageId' = a."statusPageId";

-- Keep at most one pending job per announcement/page during upgrade. Processing
-- jobs are intentionally not deleted; generation fencing makes them safe.
WITH ranked AS (
  SELECT
    j."id",
    ROW_NUMBER() OVER (
      PARTITION BY j."payload"->>'announcementId', j."payload"->>'statusPageId'
      ORDER BY j."createdAt" DESC, j."id" DESC
    ) AS rn
  FROM "BackgroundJob" AS j
  WHERE j."type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
    AND j."status" = 'PENDING'
)
DELETE FROM "BackgroundJob" AS j
USING ranked AS r
WHERE j."id" = r."id"
  AND r.rn > 1;

-- Explicit upgrade policy for already-materialized legacy email campaigns:
-- 1. If the fan-out revision still equals the canonical announcement revision,
--    promote the campaign to generation 0 in place. This preserves partial
--    delivery without re-fanning subscribers or duplicating accepted mail.
-- 2. If the revision is stale/malformed/orphaned, suppress only undelivered
--    intents. Ambiguous legacy state fails closed rather than sending stale
--    content. Already SENT/DELIVERED rows are historical truth and remain intact.
UPDATE "Notification" AS n
SET
  "status" = 'SKIPPED',
  "payloadEncrypted" = NULL,
  "lastAttemptAt" = NULL,
  "errorMsg" = 'Legacy announcement email suppressed during generation upgrade because its content revision is stale or unverifiable.'
FROM "NotificationFanout" AS f
LEFT JOIN "StatusPageAnnouncement" AS a
  ON a."id" = f."sourceId"
 AND a."statusPageId" = f."statusPageId"
WHERE n."fanoutId" = f."id"
  AND n."sourceType" = 'STATUS_PAGE_ANNOUNCEMENT'
  AND n."status" IN ('PENDING', 'FAILED')
  AND f."sourceType" = 'STATUS_PAGE_ANNOUNCEMENT'
  AND NOT (
    a."id" IS NOT NULL
    AND CASE
      WHEN f."eventKey" ~ '^\d{4}-\d{2}-\d{2}T'
        THEN f."eventKey"::timestamptz = a."updatedAt"
      ELSE FALSE
    END
  );

UPDATE "NotificationFanout" AS f
SET "eventKey" = 'generation:0'
FROM "StatusPageAnnouncement" AS a
WHERE f."sourceType" = 'STATUS_PAGE_ANNOUNCEMENT'
  AND f."sourceId" = a."id"
  AND f."statusPageId" = a."statusPageId"
  AND CASE
    WHEN f."eventKey" ~ '^\d{4}-\d{2}-\d{2}T'
      THEN f."eventKey"::timestamptz = a."updatedAt"
    ELSE FALSE
  END;

-- Reconciliation and cancellation target announcement/page inside JSON payload.
-- Keep this partial expression index small and limited to live fan-out jobs.
CREATE INDEX "BackgroundJob_announcement_fanout_live_idx"
ON "BackgroundJob" (
  ("payload"->>'announcementId'),
  ("payload"->>'statusPageId')
)
WHERE "type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
  AND "status" IN ('PENDING', 'PROCESSING');
