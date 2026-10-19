-- Nullable without default: metadata-only, no rewrite or backfill; historical rows stay NULL.
ALTER TABLE "IncidentAutomationDecision" ADD COLUMN "responseContext" JSONB;

-- NOT VALID skips the scan of existing rows (all NULL) while enforcing new inserts.
-- Updates are already rejected by automation_decision_immutable.
-- Every operand is non-NULL so the CHECK can never pass by evaluating to NULL.
ALTER TABLE "IncidentAutomationDecision" ADD CONSTRAINT "IncidentAutomationDecision_responseContext_live_check"
CHECK (
  "responseContext" IS NULL OR (
    "mode" = 'LIVE'
    AND "fallbackReason" IS NULL
    AND "versionId" IS NOT NULL
    AND jsonb_typeof("responseContext") = 'object'
    AND coalesce("responseContext"->>'versionId' = "versionId", false)
  )
) NOT VALID;
