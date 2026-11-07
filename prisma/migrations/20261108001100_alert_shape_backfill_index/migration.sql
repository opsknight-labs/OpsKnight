CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_shape_backfill"
ON "Alert" ("createdAt", id) WHERE severity IS NULL;
