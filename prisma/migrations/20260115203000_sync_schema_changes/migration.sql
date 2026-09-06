-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "signatureSecret" TEXT;

-- CreateIndex
CREATE INDEX "EscalationRule_policyId_idx" ON "EscalationRule"("policyId");

-- CreateIndex
CREATE INDEX "EscalationRule_targetUserId_idx" ON "EscalationRule"("targetUserId");

-- CreateIndex
CREATE INDEX "EscalationRule_targetTeamId_idx" ON "EscalationRule"("targetTeamId");

-- CreateIndex
CREATE INDEX "EscalationRule_targetScheduleId_idx" ON "EscalationRule"("targetScheduleId");

-- CreateIndex
CREATE INDEX "Service_teamId_idx" ON "Service"("teamId");

-- CreateIndex
CREATE INDEX "Service_escalationPolicyId_idx" ON "Service"("escalationPolicyId");
