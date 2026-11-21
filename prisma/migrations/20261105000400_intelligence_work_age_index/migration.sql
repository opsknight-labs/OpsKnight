-- Independent online migration; bounded oldest-first candidates enable fair queue aging.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_intelligence_work_oldest_unleased"
ON "IntelligenceWorkItem" ("createdAt", "id") WHERE "claimToken" IS NULL;
