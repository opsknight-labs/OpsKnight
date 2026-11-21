-- Standalone, non-transactional migration: do not block ongoing relationship review writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_intelligence_suggestion_reviews"
ON "IncidentRelationshipEvent" ("createdAt" DESC, id DESC)
WHERE "actorType" = 'USER' AND "fromDecision" = 'SUGGESTED'
  AND "toDecision" IN ('ACCEPTED', 'REJECTED');
