-- Separate migration: PostgreSQL concurrent index creation cannot run in a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_background_job_intelligence_paging"
ON "BackgroundJob" (("payload"->>'incidentId'), "scheduledAt")
WHERE "status" IN ('PENDING', 'PROCESSING', 'PENDING_V2', 'PROCESSING_V2')
  AND "type" IN ('ESCALATION', 'SCHEDULED_TASK');
