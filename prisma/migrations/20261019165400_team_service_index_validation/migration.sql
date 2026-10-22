DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = idx.relnamespace
    WHERE ns.nspname = 'public' AND idx.relname = 'Service_team_page_idx'
      AND tbl.relname = 'Service' AND i.indisvalid AND i.indisready
  ) THEN RAISE EXCEPTION 'Team service pagination index is absent or invalid; repair the concurrent build before deployment';
  END IF;
END;
$$;
