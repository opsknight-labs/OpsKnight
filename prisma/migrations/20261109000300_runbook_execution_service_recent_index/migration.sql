-- Standalone concurrent build; no transaction wrapper. Runbook outcome ranking aggregates a service's
-- recent executions; without this index that is a full scan of RunbookExecution per analysis.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_runbook_execution_service_recent"
ON "RunbookExecution" ("serviceId", "createdAt");
