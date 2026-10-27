-- Retain the existing job type and per-incident/lane predecessor contract.
-- Only active, retry-eligible rows enter these independently claimed lanes.
CREATE INDEX "BackgroundJob_responder_live_order_idx"
ON "BackgroundJob" ("scheduledAt", "createdAt", "id")
WHERE "status" IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus",
  'PENDING_V2'::"JobStatus", 'PROCESSING_V2'::"JobStatus")
  AND "attempts" < "maxAttempts"
  AND "type" = 'SCHEDULED_TASK'::"JobType"
  AND payload->>'task' = 'EVENT_SIDE_EFFECT'
  AND payload->>'lane' = 'PERSONAL_NOTIFICATION';

-- COALESCE retains legacy jobs with absent task/lane fields in the ordinary
-- lane; SQL NULL must not silently exclude those jobs from both consumers.
CREATE INDEX "BackgroundJob_general_live_order_idx"
ON "BackgroundJob" ("scheduledAt", "createdAt", "id")
WHERE "status" IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus",
  'PENDING_V2'::"JobStatus", 'PROCESSING_V2'::"JobStatus")
  AND "attempts" < "maxAttempts"
  AND NOT COALESCE(("type" = 'SCHEDULED_TASK'::"JobType"
    AND payload->>'task' = 'EVENT_SIDE_EFFECT'
    AND payload->>'lane' = 'PERSONAL_NOTIFICATION'), false);
