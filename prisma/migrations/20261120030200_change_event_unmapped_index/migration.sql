-- Unmapped changes per integration for the /changes mapping list. Built online so change webhooks are never
-- blocked; kept alone because CONCURRENTLY can't run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_change_event_unmapped_recent"
  ON "ChangeEvent" ("unmappedIntegrationId", "occurredAt" DESC);
