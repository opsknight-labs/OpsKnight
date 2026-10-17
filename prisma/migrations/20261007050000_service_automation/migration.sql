-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('DISABLED', 'SHADOW', 'LIVE');

-- CreateEnum
CREATE TYPE "AutomationRouteType" AS ENUM ('SERVICE_DEFAULT', 'ESCALATION_POLICY', 'NO_ESCALATION');

-- CreateTable
CREATE TABLE "ServiceAutomationConfig" (
    "serviceId" TEXT NOT NULL,
    "mode" "AutomationMode" NOT NULL DEFAULT 'DISABLED',
    "activeVersionId" TEXT,
    "draftId" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAutomationConfig_pkey" PRIMARY KEY ("serviceId")
);

-- CreateTable
CREATE TABLE "AutomationDraft" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationVersion" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "compiledSnapshot" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lintReport" JSONB NOT NULL,

    CONSTRAINT "AutomationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationVersionPolicyRef" (
    "versionId" TEXT NOT NULL,
    "escalationPolicyId" TEXT NOT NULL,
    "policyNameSnapshot" TEXT NOT NULL,

    CONSTRAINT "AutomationVersionPolicyRef_pkey" PRIMARY KEY ("versionId","escalationPolicyId")
);

-- CreateTable
CREATE TABLE "IncidentAutomationDecision" (
    "incidentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "versionId" TEXT,
    "mode" "AutomationMode" NOT NULL,
    "routeType" "AutomationRouteType" NOT NULL,
    "escalationPolicyId" TEXT,
    "escalationPolicyNameSnapshot" TEXT,
    "matchedRouteRuleId" TEXT,
    "matchedRouteRuleName" TEXT,
    "basePriority" TEXT,
    "finalPriority" TEXT,
    "evaluationAt" TIMESTAMP(3) NOT NULL,
    "fallbackReason" TEXT,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentAutomationDecision_pkey" PRIMARY KEY ("incidentId")
);

-- CreateTable
CREATE TABLE "AutomationTrace" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "versionId" TEXT,
    "mode" "AutomationMode" NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'INITIAL',
    "evaluationAt" TIMESTAMP(3) NOT NULL,
    "durationMs" DOUBLE PRECISION NOT NULL,
    "fallbackReason" TEXT,
    "detail" JSONB NOT NULL,

    CONSTRAINT "AutomationTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationShadowAggregate" (
    "serviceId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "bucketDate" DATE NOT NULL,
    "evaluated" INTEGER NOT NULL DEFAULT 0,
    "same" INTEGER NOT NULL DEFAULT 0,
    "routeDifferent" INTEGER NOT NULL DEFAULT 0,
    "priorityDifferent" INTEGER NOT NULL DEFAULT 0,
    "noEscalationDifferent" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "fallbacks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AutomationShadowAggregate_pkey" PRIMARY KEY ("serviceId","versionId","bucketDate")
);

-- CreateTable
CREATE TABLE "AutomationContextObservation" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "integrationType" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "normalizedRawValueHash" TEXT NOT NULL,
    "rawValuePreview" TEXT NOT NULL,
    "unmapped" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationContextObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAutomationConfig_activeVersionId_key" ON "ServiceAutomationConfig"("activeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAutomationConfig_draftId_key" ON "ServiceAutomationConfig"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationDraft_serviceId_key" ON "AutomationDraft"("serviceId");

-- CreateIndex
CREATE INDEX "AutomationVersion_serviceId_publishedAt_idx" ON "AutomationVersion"("serviceId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationVersion_serviceId_versionNumber_key" ON "AutomationVersion"("serviceId", "versionNumber");

-- CreateIndex
CREATE INDEX "AutomationVersionPolicyRef_escalationPolicyId_idx" ON "AutomationVersionPolicyRef"("escalationPolicyId");

-- CreateIndex
CREATE INDEX "IncidentAutomationDecision_escalationPolicyId_idx" ON "IncidentAutomationDecision"("escalationPolicyId");

-- CreateIndex
CREATE INDEX "IncidentAutomationDecision_serviceId_createdAt_idx" ON "IncidentAutomationDecision"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationTrace_serviceId_evaluationAt_idx" ON "AutomationTrace"("serviceId", "evaluationAt");

-- CreateIndex
CREATE INDEX "AutomationTrace_evaluationAt_idx" ON "AutomationTrace"("evaluationAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTrace_incidentId_phase_key" ON "AutomationTrace"("incidentId", "phase");

-- CreateIndex
CREATE INDEX "AutomationContextObservation_serviceId_lastSeenAt_idx" ON "AutomationContextObservation"("serviceId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationContextObservation_serviceId_integrationId_fieldK_key" ON "AutomationContextObservation"("serviceId", "integrationId", "fieldKey", "normalizedRawValueHash");

-- AddForeignKey
ALTER TABLE "ServiceAutomationConfig" ADD CONSTRAINT "ServiceAutomationConfig_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAutomationConfig" ADD CONSTRAINT "ServiceAutomationConfig_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "AutomationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAutomationConfig" ADD CONSTRAINT "ServiceAutomationConfig_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AutomationDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationDraft" ADD CONSTRAINT "AutomationDraft_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersionPolicyRef" ADD CONSTRAINT "AutomationVersionPolicyRef_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAutomationDecision" ADD CONSTRAINT "IncidentAutomationDecision_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAutomationDecision" ADD CONSTRAINT "IncidentAutomationDecision_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAutomationDecision" ADD CONSTRAINT "IncidentAutomationDecision_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrace" ADD CONSTRAINT "AutomationTrace_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrace" ADD CONSTRAINT "AutomationTrace_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrace" ADD CONSTRAINT "AutomationTrace_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationShadowAggregate" ADD CONSTRAINT "AutomationShadowAggregate_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationShadowAggregate" ADD CONSTRAINT "AutomationShadowAggregate_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationContextObservation" ADD CONSTRAINT "AutomationContextObservation_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Published snapshots and pinned decisions are append-only.
CREATE FUNCTION automation_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published automation versions and incident decisions are immutable'; END $$;
CREATE TRIGGER automation_version_immutable BEFORE UPDATE ON "AutomationVersion" FOR EACH ROW EXECUTE FUNCTION automation_reject_update();
CREATE TRIGGER automation_decision_immutable BEFORE UPDATE ON "IncidentAutomationDecision" FOR EACH ROW EXECUTE FUNCTION automation_reject_update();

CREATE FUNCTION automation_config_service_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."activeVersionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AutomationVersion" WHERE id = NEW."activeVersionId" AND "serviceId" = NEW."serviceId") THEN
    RAISE EXCEPTION 'Automation version belongs to another service';
  END IF;
  IF NEW."draftId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AutomationDraft" WHERE id = NEW."draftId" AND "serviceId" = NEW."serviceId") THEN
    RAISE EXCEPTION 'Automation draft belongs to another service';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_config_service_guard BEFORE INSERT OR UPDATE ON "ServiceAutomationConfig" FOR EACH ROW EXECUTE FUNCTION automation_config_service_guard();

-- Take a row lock while publishing references; deletion and publish cannot race.
CREATE FUNCTION automation_policy_ref_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "EscalationPolicy" WHERE id = NEW."escalationPolicyId" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referenced escalation policy is missing'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_policy_ref_guard BEFORE INSERT ON "AutomationVersionPolicyRef" FOR EACH ROW EXECUTE FUNCTION automation_policy_ref_guard();
CREATE FUNCTION automation_policy_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AutomationVersionPolicyRef" r JOIN "ServiceAutomationConfig" c ON c."activeVersionId" = r."versionId" WHERE r."escalationPolicyId" = OLD.id)
  OR EXISTS (SELECT 1 FROM "IncidentAutomationDecision" d JOIN "Incident" i ON i.id = d."incidentId" WHERE d."escalationPolicyId" = OLD.id AND i.status <> 'RESOLVED') THEN
    RAISE EXCEPTION 'Policy is referenced by active automation or an active incident';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER automation_policy_delete_guard BEFORE DELETE ON "EscalationPolicy" FOR EACH ROW EXECUTE FUNCTION automation_policy_delete_guard();
