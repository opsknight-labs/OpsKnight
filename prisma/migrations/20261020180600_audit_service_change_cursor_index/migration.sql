-- Service change metadata read from canonical audit events. Build online.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_service_change_cursor"
  ON "AuditLog" ("entityType", "entityId", "createdAt" DESC, "id" DESC);
