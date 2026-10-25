-- Compact dispatch uses protected V2 states that older ordinary consumers cannot
-- claim. Include them in the active predecessor lookup; retain the legacy index
-- for maintenance-window rollback compatibility and measure before consolidation.
CREATE INDEX "BackgroundJob_event_effect_all_live_idx"
ON "BackgroundJob" ((payload->>'incidentId'), (payload->>'lane'))
WHERE type='SCHEDULED_TASK'::"JobType"
  AND status IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus",
    'PENDING_V2'::"JobStatus", 'PROCESSING_V2'::"JobStatus")
  AND payload->>'task'='EVENT_SIDE_EFFECT';
