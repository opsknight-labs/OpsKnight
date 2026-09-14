-- Keep V2 reconciliation/cancellation indexed without bloating the general job table.
CREATE INDEX "BackgroundJob_announcement_fanout_v2_live_idx"
ON "BackgroundJob" (
  ("payload"->>'announcementId'),
  ("payload"->>'statusPageId')
)
WHERE "type" = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'
  AND "status" IN ('PENDING_V2', 'PROCESSING_V2');
