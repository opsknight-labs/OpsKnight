-- Built concurrently so AuditLog keeps accepting writes. One statement per migration:
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_channel_createdAt_idx" ON "AuditLog"("channel", "createdAt");
