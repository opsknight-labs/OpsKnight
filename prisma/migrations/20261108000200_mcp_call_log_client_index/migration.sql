-- Built concurrently so the hot McpCallLog table keeps accepting writes. One statement per
-- migration: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "McpCallLog_clientId_at_idx" ON "McpCallLog"("clientId", "at" DESC);
