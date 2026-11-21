-- OpsKnight Intelligence: optional semantic vectors for similar-incident search. Plain REAL[] columns, so no
-- extension is required; similarity is a bounded dot product over unit-normalised vectors. Additive.
BEGIN;

CREATE TABLE "IncidentEmbedding" (
    "incidentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "vector" REAL[],
    "incidentCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEmbedding_pkey" PRIMARY KEY ("incidentId"),
    CONSTRAINT "IncidentEmbedding_dims_check" CHECK ("dims" BETWEEN 8 AND 4096),
    CONSTRAINT "IncidentEmbedding_vector_check" CHECK (cardinality("vector") = "dims")
);

CREATE INDEX "idx_incident_embedding_model_recent" ON "IncidentEmbedding"("model", "incidentCreatedAt" DESC);

CREATE INDEX "idx_incident_embedding_retention" ON "IncidentEmbedding"("incidentCreatedAt");

ALTER TABLE "IncidentEmbedding" ADD CONSTRAINT "IncidentEmbedding_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
