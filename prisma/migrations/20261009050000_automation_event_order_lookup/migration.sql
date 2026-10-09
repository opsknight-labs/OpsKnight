-- The existing outbox claim query fences earlier incident/lane work. Keep the
-- queue and ordering semantics unchanged while bounding each predecessor lookup.
CREATE INDEX "BackgroundJob_event_side_effect_order_live_idx"
ON "BackgroundJob" ((payload->>'incidentId'), (payload->>'lane'))
WHERE type='SCHEDULED_TASK'::"JobType"
  AND status IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus")
  AND payload->>'task'='EVENT_SIDE_EFFECT';
