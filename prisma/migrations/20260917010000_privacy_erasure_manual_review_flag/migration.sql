-- Track whether an erasure execution completed with known-partial domain
-- coverage (free text / logs / external copies) that requires operator
-- acknowledgement before the PrivacyRequest itself is marked COMPLETED.

ALTER TABLE "PrivacyErasureExecution"
  ADD COLUMN "manualReviewRequired" BOOLEAN NOT NULL DEFAULT false;

-- Marks the instant the destructive mutation transaction commits, so a retry
-- after a post-commit finalization failure can be distinguished from a fresh
-- attempt and never re-runs discovery/deletion against an already-erased subject.
ALTER TABLE "PrivacyErasureExecution"
  ADD COLUMN "mutationCommittedAt" TIMESTAMP(3);
