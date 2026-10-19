CREATE INDEX CONCURRENTLY "BackgroundJob_slo_evaluation_active_actor_idx"
ON "BackgroundJob" ((payload->>'apiClientId'))
WHERE type = 'SCHEDULED_TASK'::"JobType"
  AND status IN ('PENDING', 'PROCESSING')
  AND payload->>'task' = 'SERVICE_OBJECTIVE_EVALUATE';
