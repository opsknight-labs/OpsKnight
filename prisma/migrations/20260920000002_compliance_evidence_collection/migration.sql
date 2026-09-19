-- CreateEnum
CREATE TYPE "ComplianceEvidenceType" AS ENUM ('CONFIGURATION_SNAPSHOT', 'VERIFICATION_RESULT', 'CAPABILITY_CHECK', 'SYSTEM_STATE', 'EXECUTION_SUMMARY', 'EVALUATION_FAILURE');

-- CreateTable
CREATE TABLE "ComplianceEvidence" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "type" "ComplianceEvidenceType" NOT NULL,
    "collectorId" TEXT NOT NULL,
    "collectorVersion" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "ComplianceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceEvidence_controlId_observedAt_idx" ON "ComplianceEvidence"("controlId", "observedAt");

-- CreateIndex
CREATE INDEX "ComplianceEvidence_evaluationId_idx" ON "ComplianceEvidence"("evaluationId");

-- CreateIndex
CREATE INDEX "ComplianceEvidence_type_idx" ON "ComplianceEvidence"("type");

-- CreateIndex
CREATE INDEX "ComplianceEvidence_resourceType_resourceId_idx" ON "ComplianceEvidence"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "ComplianceEvidence_contentHash_idx" ON "ComplianceEvidence"("contentHash");

-- AddForeignKey
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "ComplianceEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
