-- Business-service catalog depth: SLO, ownership, metadata and health inputs. Every column is
-- nullable or defaulted, so rolling upgrades and old clients keep working.
CREATE TYPE "BusinessServiceLifecycle" AS ENUM ('ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED');

ALTER TABLE "BusinessService"
ADD COLUMN "sloTarget" DOUBLE PRECISION,
ADD COLUMN "sloWindowDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "ownerUserId" TEXT,
ADD COLUMN "escalationPolicyId" TEXT,
ADD COLUMN "contactChannel" TEXT,
ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "environment" TEXT,
ADD COLUMN "lifecycle" "BusinessServiceLifecycle" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN "customAttributes" JSONB,
ADD COLUMN "quorumPartialPct" INTEGER,
ADD COLUMN "quorumMajorPct" INTEGER,
ADD COLUMN "dependencyHopDepth" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "BusinessService"
ADD CONSTRAINT "BusinessService_sloTarget_range" CHECK ("sloTarget" IS NULL OR ("sloTarget" >= 90 AND "sloTarget" <= 99.999)),
ADD CONSTRAINT "BusinessService_sloWindowDays_allowed" CHECK ("sloWindowDays" IN (7, 30, 90)),
ADD CONSTRAINT "BusinessService_dependencyHopDepth_range" CHECK ("dependencyHopDepth" BETWEEN 1 AND 5),
ADD CONSTRAINT "BusinessService_quorum_range" CHECK (
  ("quorumPartialPct" IS NULL OR "quorumPartialPct" BETWEEN 1 AND 100)
  AND ("quorumMajorPct" IS NULL OR "quorumMajorPct" BETWEEN 1 AND 100)
);

CREATE INDEX "BusinessService_ownerUserId_idx" ON "BusinessService"("ownerUserId");
CREATE INDEX "BusinessService_escalationPolicyId_idx" ON "BusinessService"("escalationPolicyId");

ALTER TABLE "BusinessService" ADD CONSTRAINT "BusinessService_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessService" ADD CONSTRAINT "BusinessService_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "EscalationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quorum and hop depth change the computed (published) status, so they dirty status-page
-- snapshots like criticality and the thresholds do. SLO, ownership and metadata are internal.
DROP TRIGGER IF EXISTS business_service_snapshot_dirty ON "BusinessService";
CREATE TRIGGER business_service_snapshot_dirty
AFTER UPDATE OF "name", "description", "statusPageSummary", "criticality", "impactMinUrgency", "impactMaxPriority", "quorumPartialPct", "quorumMajorPct", "dependencyHopDepth" ON "BusinessService"
FOR EACH ROW EXECUTE FUNCTION invalidate_business_service_snapshots();
