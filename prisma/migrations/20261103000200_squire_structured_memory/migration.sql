-- Existing encrypted text remains readable. Legacy rows have no trusted provenance envelope and
-- are conservatively Personal; new writers explicitly persist the highest declared classification.
ALTER TABLE "SquireMessage"
  ADD COLUMN "envelopeEncrypted" TEXT,
  ADD COLUMN "dataClass" "AiDataClass" NOT NULL DEFAULT 'PERSONAL';
