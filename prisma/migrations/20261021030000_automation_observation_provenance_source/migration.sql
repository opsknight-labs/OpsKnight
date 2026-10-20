-- Persist observation provenance source (PROVIDER | EVENT) to prevent misclassification.
-- Older observations retain NULL (provenance-unknown).

ALTER TABLE "AutomationContextObservation"
  ADD COLUMN IF NOT EXISTS "source" TEXT;
