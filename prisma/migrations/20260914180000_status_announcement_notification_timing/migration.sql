-- Durable announcement notification policy + generation fencing.
-- Existing announcements default fail-closed to NONE unless an existing
-- pending/processing fan-out proves the previous scheduling intent.
ALTER TABLE "StatusPageAnnouncement"
  ADD COLUMN "notificationTiming" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "notificationGeneration" INTEGER NOT NULL DEFAULT 0;

-- Recover legacy timing from durable fan-out jobs where possible.
UPDATE "StatusPageAnnouncement" AS a
SET "notificationTiming" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "BackgroundJob" AS j
    WHERE j."type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
      AND j."status" IN ('PENDING', 'PROCESSING')
      AND j."payload"->>'announcementId' = a."id"
      AND j."payload"->>'statusPageId' = a."statusPageId"
      AND j."scheduledAt" = a."startDate"
  ) THEN 'AT_START'
  WHEN EXISTS (
    SELECT 1
    FROM "BackgroundJob" AS j
    WHERE j."type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
      AND j."status" IN ('PENDING', 'PROCESSING')
      AND j."payload"->>'announcementId' = a."id"
      AND j."payload"->>'statusPageId' = a."statusPageId"
      AND j."scheduledAt" = a."publishAt"
  ) THEN 'ON_PUBLISH'
  ELSE 'NONE'
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

ALTER TABLE "StatusPageAnnouncement"
  ADD CONSTRAINT "StatusPageAnnouncement_notificationTiming_check"
  CHECK ("notificationTiming" IN ('NONE', 'ON_PUBLISH', 'AT_START'));
