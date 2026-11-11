-- Operations rollups are read per subject (a user, a runbook, an automation version) over a date range.
-- Concurrent, so writers to MetricRollup are never blocked; one index per migration file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_metric_rollup_subject" ON "MetricRollup"("name", "subjectKey", "bucket");
