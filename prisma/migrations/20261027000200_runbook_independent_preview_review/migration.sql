ALTER TABLE "RunbookPreviewAuthorization"
  ADD COLUMN "independentReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requesterGrantId" TEXT,
  ADD COLUMN "requesterCredentialId" TEXT,
  ADD COLUMN "requestEnvelope" TEXT,
  ADD COLUMN "reviewSummary" JSONB,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewerTokenVersion" INTEGER,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedPlanDigest" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3);

CREATE INDEX "RunbookPreviewAuthorization_requesterGrantId_createdAt_idx"
  ON "RunbookPreviewAuthorization"("requesterGrantId", "createdAt");

ALTER TABLE "RunbookPreviewAuthorization" ADD CONSTRAINT "runbook_preview_review_provenance"
CHECK (NOT "independentReview" OR
  ("requesterGrantId" IS NOT NULL AND "requesterCredentialId" IS NOT NULL));

ALTER TABLE "RunbookPreviewAuthorization" ADD CONSTRAINT "runbook_preview_distinct_reviewer"
CHECK ("reviewedById" IS NULL OR
  ("independentReview" AND "reviewedById" <> "actorId" AND "reviewedAt" IS NOT NULL
   AND "reviewerTokenVersion" IS NOT NULL AND "reviewedPlanDigest" IS NOT NULL
   AND "rejectedAt" IS NULL));
