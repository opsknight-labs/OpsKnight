-- Similarity retrieval that stays fast as history grows.
--
-- Full-text: the tsvector is stored instead of being recomputed from the template for every matching row
-- when results are ranked, which was most of the query's cost. Its statistics also give word frequencies,
-- so very common words are left out of the query.
--
-- Trigram: a GiST index answers "nearest templates first" (ORDER BY template <-> query LIMIT n) by walking
-- the index in similarity order and stopping after n rows, instead of collecting and sorting every match.
BEGIN;

ALTER TABLE "IncidentFingerprint"
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "template")) STORED;
CREATE INDEX "idx_incident_fingerprint_search" ON "IncidentFingerprint" USING GIN ("searchVector");
DROP INDEX IF EXISTS "idx_incident_fingerprint_fts";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_incident_fingerprint_trgm_gist" ON "IncidentFingerprint" USING GIST ("template" gist_trgm_ops)';
    EXECUTE 'DROP INDEX IF EXISTS "idx_incident_fingerprint_trgm"';
  END IF;
END
$$;

ANALYZE "IncidentFingerprint";

COMMIT;
