-- Existing rows were emitted only by the live path, so the backfill default is truthful.
ALTER TABLE "sla_performance_logs"
ADD COLUMN "dataSource" TEXT NOT NULL DEFAULT 'live';

CREATE INDEX "sla_performance_logs_timestamp_dataSource_idx"
ON "sla_performance_logs"("timestamp", "dataSource");
