-- Every external issue link must belong to exactly one OpsKnight domain owner.
-- The application also enforces this invariant under an external-key advisory
-- lock, but the database constraint provides defense in depth against future
-- code paths, races, or manual writes.
ALTER TABLE "ExternalIssueLink"
  DROP CONSTRAINT IF EXISTS "ExternalIssueLink_exactly_one_owner_check";

ALTER TABLE "ExternalIssueLink"
  ADD CONSTRAINT "ExternalIssueLink_exactly_one_owner_check"
  CHECK (num_nonnulls("incidentId", "actionItemId") = 1)
  NOT VALID;

-- Deliberately validate existing data during deployment. If historical
-- corruption exists, fail the migration rather than silently preserving an
-- ambiguous ownership row.
ALTER TABLE "ExternalIssueLink"
  VALIDATE CONSTRAINT "ExternalIssueLink_exactly_one_owner_check";
