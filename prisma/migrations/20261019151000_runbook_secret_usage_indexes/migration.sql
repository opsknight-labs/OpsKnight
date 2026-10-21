-- Expression indexes match the resolver's top-level SECRET_REF input semantics.
-- Concurrent creation keeps populated execution/rule tables writable during deployment.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ServiceRunbookBinding_secret_input_values_idx"
 ON "ServiceRunbookBinding" USING GIN (jsonb_path_query_array("inputValues", '$.*') jsonb_path_ops);
