-- The original completion-metrics migration already supplies this partial index.
-- Keep its established name and avoid duplicate write/storage maintenance.
DROP INDEX IF EXISTS "IngestionReceipt_completed_metrics_idx";
