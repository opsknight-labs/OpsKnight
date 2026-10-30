-- An administrator may approve their own MCP request after explicit confirmation. The
-- application enforces the role and the confirmation; the database keeps the invariant that a
-- requester reviewing their own request is always recorded as such.
ALTER TABLE "McpOperationApproval" ADD COLUMN "selfApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RunbookPreviewAuthorization" ADD COLUMN "selfApproved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "McpOperationApproval" DROP CONSTRAINT "mcp_operation_approval_distinct_reviewer";
ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_distinct_reviewer"
CHECK ("reviewedById" IS NULL OR
  (("reviewedById" <> "actorId") = NOT "selfApproved" AND "reviewedAt" IS NOT NULL
   AND "reviewerTokenVersion" IS NOT NULL AND "rejectedAt" IS NULL));

ALTER TABLE "RunbookPreviewAuthorization" DROP CONSTRAINT "runbook_preview_distinct_reviewer";
ALTER TABLE "RunbookPreviewAuthorization" ADD CONSTRAINT "runbook_preview_distinct_reviewer"
CHECK ("reviewedById" IS NULL OR
  ("independentReview" AND ("reviewedById" <> "actorId") = NOT "selfApproved"
   AND "reviewedAt" IS NOT NULL AND "reviewerTokenVersion" IS NOT NULL
   AND "reviewedPlanDigest" IS NOT NULL AND "rejectedAt" IS NULL));
