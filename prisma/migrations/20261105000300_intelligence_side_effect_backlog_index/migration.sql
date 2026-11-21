-- Separate migration: keep the live paging queue writable while building the index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_background_job_intelligence_side_effect_backlog"
ON "BackgroundJob" ("scheduledAt")
WHERE "type" = 'SCHEDULED_TASK' AND "status" IN ('PENDING', 'PENDING_V2')
  AND "payload"->>'task' = 'EVENT_SIDE_EFFECT'
  AND "payload"->>'lane' IN ('PERSONAL_NOTIFICATION', 'ORDINARY_DISPATCH');
