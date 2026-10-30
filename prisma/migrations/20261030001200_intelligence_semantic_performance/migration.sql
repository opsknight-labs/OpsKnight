BEGIN;

-- Existing fingerprints get the template hash the indexer now writes, so embedding work is found by an
-- indexed comparison instead of hashing every recent template on every pass. Placeholders stay NULL.
UPDATE "IncidentFingerprint"
SET "templateHash" = left(encode(sha256(convert_to("template", 'UTF8')), 'hex'), 32)
WHERE "template" <> '' AND "templateHash" IS NULL;

-- Nearest-neighbour search is an optimisation. Managed PostgreSQL may not offer pgvector; that must never
-- fail a deployment, and semantic search then keeps using its bounded exact scan. When it is available, the
-- lane builds one HNSW expression index per vector size in the background (no column changes).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable (%); semantic search uses exact scans', SQLERRM;
  END;
END
$$;

-- The exact-scan fallback reads the most recent vectors of the incident's own service first.
CREATE INDEX "idx_incident_embedding_service_recent"
  ON "IncidentEmbedding" ("serviceId", "model", "incidentCreatedAt" DESC);

COMMIT;
