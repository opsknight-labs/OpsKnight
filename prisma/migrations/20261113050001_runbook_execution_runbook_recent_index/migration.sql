-- One online statement; do not wrap this migration in an explicit transaction.
-- Runbook health reads the most recent runs of one runbook; the single-column index cannot bound that scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_runbook_execution_runbook_recent"
ON "RunbookExecution" ("runbookId", "createdAt" DESC);
