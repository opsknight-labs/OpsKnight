-- Standalone concurrent build; no transaction wrapper.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_labels"
ON "Alert" USING GIN (labels jsonb_path_ops) WHERE labels IS NOT NULL;
