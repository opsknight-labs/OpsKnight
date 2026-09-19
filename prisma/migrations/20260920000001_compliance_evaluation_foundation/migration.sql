-- CreateEnum
CREATE TYPE "ComplianceEvaluationStatus" AS ENUM ('IMPLEMENTED', 'PARTIAL', 'ACTION_REQUIRED', 'UNVERIFIED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ComplianceEvaluationTrigger" AS ENUM ('MANUAL', 'API', 'SCHEDULED', 'DEPLOYMENT');

-- CreateTable
CREATE TABLE "ComplianceEvaluation" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "status" "ComplianceEvaluationStatus" NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
    "trigger" "ComplianceEvaluationTrigger" NOT NULL,
    "batchId" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceControlState" (
    "controlId" TEXT NOT NULL,
    "status" "ComplianceEvaluationStatus" NOT NULL,
    "latestEvaluationId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceControlState_pkey" PRIMARY KEY ("controlId")
);

-- CreateIndex
CREATE INDEX "ComplianceEvaluation_controlId_evaluatedAt_idx" ON "ComplianceEvaluation"("controlId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "ComplianceEvaluation_status_idx" ON "ComplianceEvaluation"("status");

-- CreateIndex
CREATE INDEX "ComplianceEvaluation_batchId_idx" ON "ComplianceEvaluation"("batchId");

-- CreateIndex
CREATE INDEX "ComplianceControlState_status_idx" ON "ComplianceControlState"("status");
