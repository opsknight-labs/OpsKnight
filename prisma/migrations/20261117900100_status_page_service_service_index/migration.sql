-- One online statement; do not wrap this migration in an explicit transaction.
-- The incident page's status-update lookup filters StatusPageService by serviceId alone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "StatusPageService_serviceId_idx"
ON "StatusPageService" ("serviceId");
