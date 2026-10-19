-- One online statement; do not wrap this migration in an explicit transaction.
-- The worker locks only a bounded due batch for one service.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_automation_observe_pending_idx"
ON "BackgroundJob" ((payload->>'serviceId'), "scheduledAt", id)
WHERE type = 'SCHEDULED_TASK'::"JobType" AND status = 'PENDING'::"JobStatus"
  AND payload->>'task' = 'AUTOMATION_OBSERVE';
