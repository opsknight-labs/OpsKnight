-- Versioned noise-control policies (orchestration rules included). Expand-only: one new table, two
-- nullable columns, no rewrite of existing rows. The new table is empty, so its indexes are created
-- inline. Existing policies are captured as version 1 by the bounded application backfill
-- (backfillNoiseControlPolicyVersions, run by the pre-paging sweep and lazily on first read or save), so
-- the checksum is computed the same way as for every later publish.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

CREATE TABLE IF NOT EXISTS "NoiseControlPolicyVersion" (
  "id" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "serviceId" TEXT,
  "versionNumber" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "mode" "NoiseControlMode" NOT NULL,
  "definition" JSONB NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "policyRevision" INTEGER NOT NULL,
  "origin" VARCHAR(16) NOT NULL DEFAULT 'PUBLISH',
  "sourceVersionId" TEXT,
  "publishedById" TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoiseControlPolicyVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NoiseControlPolicyVersion_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NoiseControlPolicyVersion_scopeKey_versionNumber_key" ON "NoiseControlPolicyVersion"("scopeKey", "versionNumber");
CREATE INDEX IF NOT EXISTS "NoiseControlPolicyVersion_serviceId_idx" ON "NoiseControlPolicyVersion"("serviceId");

ALTER TABLE "NoiseControlPolicy" ADD COLUMN IF NOT EXISTS "activeVersionId" TEXT;
-- NOT VALID then VALIDATE: the column is all NULL, so validation is instant and holds only a light lock.
ALTER TABLE "NoiseControlPolicy" ADD CONSTRAINT "NoiseControlPolicy_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "NoiseControlPolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "NoiseControlPolicy" VALIDATE CONSTRAINT "NoiseControlPolicy_activeVersionId_fkey";

-- Soft reference (no FK): the hot-path decision insert stays exactly as cheap as before.
ALTER TABLE "PrePagingDecision" ADD COLUMN IF NOT EXISTS "policyVersionId" TEXT;
