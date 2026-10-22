CREATE INDEX CONCURRENTLY IF NOT EXISTS "RunbookExecution_secret_input_values_idx"
 ON "RunbookExecution" USING GIN (jsonb_path_query_array("inputValues", '$.*') jsonb_path_ops);
