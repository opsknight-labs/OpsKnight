-- Keep automatic web-fallback checks independent of historical Agent fleets.
CREATE INDEX CONCURRENTLY "RuntimeWorkerHeartbeat_ingestion_healthy_idx"
  ON "RuntimeWorkerHeartbeat" ("lastSeenAt")
  WHERE lane = 'ingestion' AND role = 'ingestion-worker' AND running = true
    AND "lastError" IS NULL AND "lastSuccessAt" IS NOT NULL;
