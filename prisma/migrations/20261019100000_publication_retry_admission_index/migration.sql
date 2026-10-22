CREATE INDEX CONCURRENTLY "BackgroundJob_publication_retry_active_page_idx"
ON "BackgroundJob" ((payload->>'pageId'))
WHERE type = 'SCHEDULED_TASK'::"JobType"
  AND status IN ('PENDING', 'PROCESSING')
  AND payload->>'task' = 'STATUS_PAGE_PUBLICATION_RETRY';
