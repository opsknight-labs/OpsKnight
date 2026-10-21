CREATE INDEX CONCURRENTLY IF NOT EXISTS "Team_activity_page_idx"
ON "AuditLog" ((split_part("entityId", ':', 1)), "createdAt", id)
WHERE "entityType" IN ('TEAM', 'TEAM_MEMBER');
