-- OpsKnight Intelligence foundation. Purely additive: new tables only, no change to existing
-- columns or indexes, no backfill. Intelligence is OFF until enabled from Settings.
-- Prisma deploy does not wrap migration files in a transaction, so the file is atomic by itself.
BEGIN;

-- CreateEnum
CREATE TYPE "IntelligenceMode" AS ENUM ('OFF', 'SHADOW', 'SUGGEST', 'AUTO');

-- CreateEnum
CREATE TYPE "CorrelationGroupStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CorrelationDecision" AS ENUM ('SHADOW', 'SUGGESTED', 'ACCEPTED', 'REJECTED', 'REVERTED');

-- CreateEnum
CREATE TYPE "CorrelationMemberRole" AS ENUM ('ANCHOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "IntelligenceActorType" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "IncidentRelationshipType" AS ENUM ('RELATED', 'DUPLICATE_OF', 'CAUSED_BY');

-- CreateEnum
CREATE TYPE "IntelligenceOrigin" AS ENUM ('RULE', 'LEARNED', 'HUMAN');

-- CreateEnum
CREATE TYPE "IntelligenceFindingKind" AS ENUM ('SIMILAR_INCIDENT', 'RELATED_INCIDENT', 'RUNBOOK_RECOMMENDATION', 'PROBABLE_CAUSE', 'CHANGE_CORRELATION', 'NOISE');

-- CreateEnum
CREATE TYPE "IntelligenceFindingStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "IntelligenceFeedbackSubject" AS ENUM ('FINDING', 'CORRELATION_MEMBER', 'INCIDENT_RELATIONSHIP');

-- CreateEnum
CREATE TYPE "IntelligenceFeedbackVerdict" AS ENUM ('HELPFUL', 'NOT_HELPFUL', 'CORRECT', 'INCORRECT');

-- CreateEnum
CREATE TYPE "IntelligenceEvaluationKind" AS ENUM ('SHADOW', 'REPLAY', 'CERTIFICATION');

-- CreateEnum
CREATE TYPE "IntelligenceEvaluationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "IntelligenceSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 2,
    "batchSize" INTEGER NOT NULL DEFAULT 20,
    "maxJobMs" INTEGER NOT NULL DEFAULT 5000,
    "maxDbMs" INTEGER NOT NULL DEFAULT 2000,
    "candidateCap" INTEGER NOT NULL DEFAULT 50,
    "lookbackDays" INTEGER NOT NULL DEFAULT 30,
    "backpressureEscalationLagMs" INTEGER NOT NULL DEFAULT 15000,
    "fingerprintRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "correlationRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "findingRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "feedbackRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelligenceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligencePolicy" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "serviceId" TEXT,
    "headVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelligencePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligencePolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" "IntelligenceMode" NOT NULL DEFAULT 'OFF',
    "definition" JSONB NOT NULL,
    "reason" TEXT,
    "createdFromVersion" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligencePolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrelationGroup" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "ruleId" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "signatureHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "maxWindowEnd" TIMESTAMP(3) NOT NULL,
    "status" "CorrelationGroupStatus" NOT NULL DEFAULT 'OPEN',
    "anchorIncidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrelationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrelationMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "role" "CorrelationMemberRole" NOT NULL DEFAULT 'MEMBER',
    "decision" "CorrelationDecision" NOT NULL DEFAULT 'SHADOW',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrelationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrelationDecisionEvent" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "fromDecision" "CorrelationDecision",
    "toDecision" "CorrelationDecision" NOT NULL,
    "actorType" "IntelligenceActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrelationDecisionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentRelationship" (
    "id" TEXT NOT NULL,
    "sourceIncidentId" TEXT NOT NULL,
    "targetIncidentId" TEXT NOT NULL,
    "type" "IncidentRelationshipType" NOT NULL,
    "origin" "IntelligenceOrigin" NOT NULL,
    "decision" "CorrelationDecision" NOT NULL DEFAULT 'SUGGESTED',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentRelationshipEvent" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "fromDecision" "CorrelationDecision",
    "toDecision" "CorrelationDecision" NOT NULL,
    "actorType" "IntelligenceActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentRelationshipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentFingerprint" (
    "incidentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "tokens" TEXT[],
    "labels" JSONB NOT NULL,
    "resolutionSummary" TEXT,
    "engineVersion" TEXT NOT NULL,
    "incidentCreatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentFingerprint_pkey" PRIMARY KEY ("incidentId")
);

-- CreateTable
CREATE TABLE "IntelligencePattern" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "support" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelligencePattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceFinding" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" "IntelligenceFindingKind" NOT NULL,
    "status" "IntelligenceFindingStatus" NOT NULL DEFAULT 'ACTIVE',
    "rank" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subjectRef" TEXT,
    "evidence" JSONB NOT NULL,
    "generation" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "policyVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "IntelligenceFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceFeedback" (
    "id" TEXT NOT NULL,
    "subjectType" "IntelligenceFeedbackSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "verdict" "IntelligenceFeedbackVerdict" NOT NULL,
    "reasonCode" TEXT,
    "note" TEXT,
    "serviceId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceEvaluationRun" (
    "id" TEXT NOT NULL,
    "kind" "IntelligenceEvaluationKind" NOT NULL,
    "status" "IntelligenceEvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "policyId" TEXT,
    "policyVersion" INTEGER,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceWorkItem" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelligenceWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceCursor" (
    "name" TEXT NOT NULL,
    "watermarkAt" TIMESTAMP(3) NOT NULL,
    "lastId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelligenceCursor_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntelligencePolicy_scopeKey_key" ON "IntelligencePolicy"("scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligencePolicy_serviceId_key" ON "IntelligencePolicy"("serviceId");

-- CreateIndex
CREATE INDEX "IntelligencePolicyVersion_createdById_idx" ON "IntelligencePolicyVersion"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligencePolicyVersion_policyId_version_key" ON "IntelligencePolicyVersion"("policyId", "version");

-- CreateIndex
CREATE INDEX "idx_correlation_group_open_window" ON "CorrelationGroup"("status", "windowEnd");

-- CreateIndex
CREATE INDEX "CorrelationGroup_anchorIncidentId_idx" ON "CorrelationGroup"("anchorIncidentId");

-- CreateIndex
CREATE INDEX "idx_correlation_group_retention" ON "CorrelationGroup"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_correlation_group_identity" ON "CorrelationGroup"("policyId", "policyVersion", "ruleId", "scopeHash", "signatureHash", "windowStart");

-- CreateIndex
CREATE INDEX "CorrelationMember_incidentId_idx" ON "CorrelationMember"("incidentId");

-- CreateIndex
CREATE INDEX "CorrelationMember_groupId_decision_idx" ON "CorrelationMember"("groupId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "CorrelationMember_groupId_incidentId_key" ON "CorrelationMember"("groupId", "incidentId");

-- CreateIndex
CREATE INDEX "CorrelationDecisionEvent_memberId_createdAt_idx" ON "CorrelationDecisionEvent"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentRelationship_targetIncidentId_idx" ON "IncidentRelationship"("targetIncidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentRelationship_sourceIncidentId_targetIncidentId_type_key" ON "IncidentRelationship"("sourceIncidentId", "targetIncidentId", "type");

-- CreateIndex
CREATE INDEX "IncidentRelationshipEvent_relationshipId_createdAt_idx" ON "IncidentRelationshipEvent"("relationshipId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_incident_fingerprint_service_recent" ON "IncidentFingerprint"("serviceId", "incidentCreatedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_incident_fingerprint_retention" ON "IncidentFingerprint"("incidentCreatedAt");

-- CreateIndex
CREATE INDEX "IntelligencePattern_lastSeenAt_idx" ON "IntelligencePattern"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligencePattern_scopeKey_kind_key_key" ON "IntelligencePattern"("scopeKey", "kind", "key");

-- CreateIndex
CREATE INDEX "idx_intelligence_finding_lookup" ON "IntelligenceFinding"("incidentId", "status", "kind", "rank");

-- CreateIndex
CREATE INDEX "idx_intelligence_finding_retention" ON "IntelligenceFinding"("createdAt");

-- CreateIndex
CREATE INDEX "IntelligenceFeedback_subjectType_subjectId_idx" ON "IntelligenceFeedback"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "IntelligenceFeedback_serviceId_createdAt_idx" ON "IntelligenceFeedback"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "IntelligenceFeedback_actorId_idx" ON "IntelligenceFeedback"("actorId");

-- CreateIndex
CREATE INDEX "idx_intelligence_feedback_retention" ON "IntelligenceFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "IntelligenceEvaluationRun_kind_createdAt_idx" ON "IntelligenceEvaluationRun"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "IntelligenceEvaluationRun_createdById_idx" ON "IntelligenceEvaluationRun"("createdById");

-- CreateIndex
CREATE INDEX "idx_intelligence_work_item_ready" ON "IntelligenceWorkItem"("priority", "scheduledAt");

-- CreateIndex
CREATE INDEX "IntelligenceWorkItem_leaseUntil_idx" ON "IntelligenceWorkItem"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "uq_intelligence_work_item_subject" ON "IntelligenceWorkItem"("kind", "subjectKey");

-- AddForeignKey
ALTER TABLE "IntelligencePolicy" ADD CONSTRAINT "IntelligencePolicy_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligencePolicyVersion" ADD CONSTRAINT "IntelligencePolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "IntelligencePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligencePolicyVersion" ADD CONSTRAINT "IntelligencePolicyVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrelationGroup" ADD CONSTRAINT "CorrelationGroup_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "IntelligencePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrelationGroup" ADD CONSTRAINT "CorrelationGroup_anchorIncidentId_fkey" FOREIGN KEY ("anchorIncidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrelationMember" ADD CONSTRAINT "CorrelationMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CorrelationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrelationMember" ADD CONSTRAINT "CorrelationMember_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrelationDecisionEvent" ADD CONSTRAINT "CorrelationDecisionEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CorrelationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentRelationship" ADD CONSTRAINT "IncidentRelationship_sourceIncidentId_fkey" FOREIGN KEY ("sourceIncidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentRelationship" ADD CONSTRAINT "IncidentRelationship_targetIncidentId_fkey" FOREIGN KEY ("targetIncidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentRelationshipEvent" ADD CONSTRAINT "IncidentRelationshipEvent_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "IncidentRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentFingerprint" ADD CONSTRAINT "IncidentFingerprint_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentFingerprint" ADD CONSTRAINT "IncidentFingerprint_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceFinding" ADD CONSTRAINT "IntelligenceFinding_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceFeedback" ADD CONSTRAINT "IntelligenceFeedback_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceEvaluationRun" ADD CONSTRAINT "IntelligenceEvaluationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integrity constraints Prisma cannot express.
ALTER TABLE "IntelligenceSettings"
  ADD CONSTRAINT "IntelligenceSettings_bounds_check" CHECK (
    "maxConcurrency" BETWEEN 1 AND 16
    AND "batchSize" BETWEEN 1 AND 500
    AND "maxJobMs" BETWEEN 100 AND 120000
    AND "maxDbMs" BETWEEN 50 AND 60000
    AND "candidateCap" BETWEEN 1 AND 500
    AND "lookbackDays" BETWEEN 1 AND 3650
    AND "backpressureEscalationLagMs" BETWEEN 1000 AND 3600000
    AND "fingerprintRetentionDays" >= 1 AND "correlationRetentionDays" >= 1
    AND "findingRetentionDays" >= 1 AND "feedbackRetentionDays" >= 1
  );
ALTER TABLE "CorrelationGroup"
  ADD CONSTRAINT "CorrelationGroup_window_check" CHECK (
    "windowStart" < "windowEnd" AND "windowEnd" <= "maxWindowEnd"
  );
ALTER TABLE "CorrelationMember"
  ADD CONSTRAINT "CorrelationMember_score_check" CHECK ("score" >= 0 AND "score" <= 1);
ALTER TABLE "IncidentRelationship"
  ADD CONSTRAINT "IncidentRelationship_score_check" CHECK ("score" >= 0 AND "score" <= 1),
  ADD CONSTRAINT "IncidentRelationship_distinct_check" CHECK ("sourceIncidentId" <> "targetIncidentId");
ALTER TABLE "IntelligenceFinding"
  ADD CONSTRAINT "IntelligenceFinding_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1);
ALTER TABLE "IntelligencePattern"
  ADD CONSTRAINT "IntelligencePattern_counts_check" CHECK (
    "successes" >= 0 AND "failures" >= 0 AND "support" >= 0
  );

-- Ready-work lookup only needs rows that are not currently leased.
CREATE INDEX "idx_intelligence_work_item_unleased" ON "IntelligenceWorkItem" ("priority", "scheduledAt")
  WHERE "claimToken" IS NULL;

-- Full-text similarity is always available. The expression index matches the query expression
-- exactly (to_tsvector('simple', template)), so no generated column is required.
CREATE INDEX "idx_incident_fingerprint_fts" ON "IncidentFingerprint"
  USING GIN (to_tsvector('simple', "template"));

-- Trigram similarity is an optimisation. Managed PostgreSQL may not allow the extension; that must
-- never fail a deployment. Runtime capability detection reports which tier is active.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable (%); similarity falls back to full-text search', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_incident_fingerprint_trgm" ON "IncidentFingerprint" USING GIN ("template" gin_trgm_ops)';
  END IF;
END
$$;

-- Immutability guarantees. Rollback and reversal are new rows; history is never rewritten.
-- Only UPDATE is blocked: DELETE must stay possible for retention and cascading cleanup.
CREATE FUNCTION intelligence_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;
-- The only permitted change to a policy version is clearing the author when a user is erased
-- (ON DELETE SET NULL); every behavioural field stays frozen.
CREATE FUNCTION intelligence_policy_version_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."createdById" IS NULL
     AND (to_jsonb(NEW) - 'createdById') = (to_jsonb(OLD) - 'createdById') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;
CREATE TRIGGER intelligence_policy_version_immutable BEFORE UPDATE ON "IntelligencePolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION intelligence_policy_version_reject_update();
CREATE TRIGGER correlation_decision_event_immutable BEFORE UPDATE ON "CorrelationDecisionEvent"
  FOR EACH ROW EXECUTE FUNCTION intelligence_reject_update();
CREATE TRIGGER incident_relationship_event_immutable BEFORE UPDATE ON "IncidentRelationshipEvent"
  FOR EACH ROW EXECUTE FUNCTION intelligence_reject_update();

COMMIT;

