-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'COMPLIANCE_DRIFT_EVENT';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'COMPLIANCE_MONITORING_RUN';

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'COMPLIANCE_EVALUATION_SWEEP';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'COMPLIANCE_DRIFT_PROJECT';

-- CreateEnum
CREATE TYPE "ComplianceDriftStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ComplianceDriftKind" AS ENUM ('CONTROL_STATUS_REGRESSION', 'CONTROL_UNVERIFIED', 'FINDING_SET_CHANGED', 'EVIDENCE_INTEGRITY_MISMATCH', 'EVALUATOR_VERSION_CHANGED', 'APPLICABILITY_CHANGED', 'FRAMEWORK_LIFECYCLE_CHANGED');

-- CreateEnum
CREATE TYPE "ComplianceDriftImpact" AS ENUM ('ACTION_REQUIRED', 'VERIFICATION_GAP', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "ComplianceMonitoringRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED');

-- CreateTable
CREATE TABLE "ComplianceDriftBaseline" (
    "controlId" TEXT NOT NULL,
    "lastEvaluationId" TEXT NOT NULL,
    "lastEvaluationCreatedAt" TIMESTAMP(3) NOT NULL,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedStatus" "ComplianceEvaluationStatus" NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "observationFingerprint" TEXT NOT NULL,
    "findingFingerprint" TEXT NOT NULL,
    "evidenceFingerprint" TEXT,
    "establishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDriftBaseline_pkey" PRIMARY KEY ("controlId")
);

-- CreateTable
CREATE TABLE "ComplianceDriftEvent" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "controlId" TEXT,
    "framework" TEXT,
    "requirementId" TEXT,
    "kind" "ComplianceDriftKind" NOT NULL,
    "impact" "ComplianceDriftImpact" NOT NULL,
    "status" "ComplianceDriftStatus" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "activeDedupeKey" TEXT,
    "baselineEvaluationId" TEXT,
    "detectedEvaluationId" TEXT,
    "resolutionEvaluationId" TEXT,
    "previousStatus" "ComplianceEvaluationStatus",
    "currentStatus" "ComplianceEvaluationStatus",
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "notificationGeneration" INTEGER NOT NULL DEFAULT 0,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDriftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceMonitoringRun" (
    "id" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ComplianceMonitoringRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "controlsTargeted" INTEGER NOT NULL DEFAULT 0,
    "controlsEvaluated" INTEGER NOT NULL DEFAULT 0,
    "controlsFailed" INTEGER NOT NULL DEFAULT 0,
    "driftOpened" INTEGER NOT NULL DEFAULT 0,
    "driftResolved" INTEGER NOT NULL DEFAULT 0,
    "frameworkChanges" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceMonitoringRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceDriftEvent_activeDedupeKey_key" ON "ComplianceDriftEvent"("activeDedupeKey");

-- CreateIndex
CREATE INDEX "ComplianceDriftEvent_status_firstDetectedAt_idx" ON "ComplianceDriftEvent"("status", "firstDetectedAt");

-- CreateIndex
CREATE INDEX "ComplianceDriftEvent_controlId_status_idx" ON "ComplianceDriftEvent"("controlId", "status");

-- CreateIndex
CREATE INDEX "ComplianceDriftEvent_kind_status_idx" ON "ComplianceDriftEvent"("kind", "status");

-- CreateIndex
CREATE INDEX "ComplianceDriftEvent_framework_requirementId_idx" ON "ComplianceDriftEvent"("framework", "requirementId");

-- CreateIndex
CREATE INDEX "ComplianceMonitoringRun_status_scheduledFor_idx" ON "ComplianceMonitoringRun"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceEvaluation_batchId_controlId_key" ON "ComplianceEvaluation"("batchId", "controlId");
