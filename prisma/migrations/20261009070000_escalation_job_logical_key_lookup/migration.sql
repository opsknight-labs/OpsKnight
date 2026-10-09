-- Escalation deduplication compares a JSONB scalar, not its text projection.
-- Index the exact Prisma expression so lookup does not scan every runnable
-- escalation job or predicate-lock unrelated jobs in Serializable transactions.
-- Include type/status rather than using a partial predicate: prepared statements
-- must remain eligible for the index even when PostgreSQL selects a generic plan.
CREATE INDEX "BackgroundJob_escalation_logical_key_lookup_idx"
ON "BackgroundJob" (("payload" #> ARRAY['logicalKey']::text[]), "type", "status");
