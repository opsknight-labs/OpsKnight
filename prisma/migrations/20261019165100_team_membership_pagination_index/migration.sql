CREATE INDEX CONCURRENTLY IF NOT EXISTS "TeamMember_team_page_idx"
ON "TeamMember" ("teamId", "createdAt", id);
