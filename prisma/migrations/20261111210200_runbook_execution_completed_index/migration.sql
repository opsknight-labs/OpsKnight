-- The daily runbook-outcome rollup reads the executions that finished in one day.
-- Concurrent, so runbook execution writes are never blocked; one index per migration file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_runbook_execution_completed" ON "RunbookExecution"("completedAt");
