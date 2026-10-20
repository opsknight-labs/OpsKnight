-- Related incident evidence by recorded correlation key. Build online.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_alert_correlation_recent"
  ON "Alert" ("dedupKey", "createdAt" DESC, "id" DESC);
