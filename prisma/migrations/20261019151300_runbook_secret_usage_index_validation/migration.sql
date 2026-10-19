-- CREATE INDEX CONCURRENTLY can leave an invalid index after interruption.
-- Never treat IF NOT EXISTS as proof that the required access paths are usable.
DO $$
DECLARE indexes_ready BOOLEAN;
BEGIN
 SELECT count(*) = 3 AND bool_and(i.indisvalid AND i.indisready)
 INTO indexes_ready
 FROM pg_catalog.pg_index i
 JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
 JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
 JOIN pg_catalog.pg_namespace ns ON ns.oid = idx.relnamespace
 WHERE ns.nspname = 'public' AND (idx.relname, tbl.relname) IN (
  ('ServiceRunbookBinding_secret_input_values_idx', 'ServiceRunbookBinding'),
  ('RunbookExecution_secret_input_values_idx', 'RunbookExecution'),
  ('RunbookInput_secret_default_usage_idx', 'RunbookInput')
 );
 IF NOT COALESCE(indexes_ready, false) THEN
  RAISE EXCEPTION 'Runbook secret usage indexes are absent or invalid; repair the interrupted concurrent index build before deployment';
 END IF;
END;
$$;
