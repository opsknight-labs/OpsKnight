CREATE INDEX CONCURRENTLY IF NOT EXISTS "RunbookInput_secret_default_usage_idx"
 ON "RunbookInput" ("defaultValue", "createdAt", id) WHERE type = 'SECRET_REF';
