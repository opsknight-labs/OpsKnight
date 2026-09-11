ALTER TABLE "StatusPageSnapshot"
  ADD COLUMN "buildLeaseToken" TEXT,
  ADD COLUMN "buildLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "StatusPageSnapshot_buildLeaseExpiresAt_idx"
  ON "StatusPageSnapshot"("buildLeaseExpiresAt");
