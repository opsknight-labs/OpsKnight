-- The remainder claim lane must stop after its bounded sequence-ordered prefix,
-- rather than evaluating predecessor checks for every active receipt then sorting.
-- Build online so an image upgrade does not take a write-blocking table lock.
CREATE INDEX CONCURRENTLY "IngestionReceipt_claim_sequence_idx"
  ON "IngestionReceipt" ("sequence")
  WHERE "status" IN ('PENDING', 'PROCESSING');
