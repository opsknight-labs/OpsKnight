-- Storm cascade probe/page: unclaimed pre-paging storm links only. The sweep marks every link it settles
-- (including ones whose child already resolved), so this stays bounded by live storms.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_incident_relationship_storm_open"
ON "IncidentRelationship" ("targetIncidentId")
WHERE type = 'PARENT_CHILD'
  AND (evidence->>'kind') = 'prepaging_storm'
  AND (evidence->>'cascadedAt') IS NULL;
