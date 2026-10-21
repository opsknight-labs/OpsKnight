-- AlterTable
ALTER TABLE "ServiceAutomationConfig" ADD COLUMN IF NOT EXISTS "candidateVersionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceAutomationConfig_candidateVersionId_key" ON "ServiceAutomationConfig"("candidateVersionId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceAutomationConfig_candidateVersionId_fkey') THEN
    ALTER TABLE "ServiceAutomationConfig" ADD CONSTRAINT "ServiceAutomationConfig_candidateVersionId_fkey"
      FOREIGN KEY ("candidateVersionId") REFERENCES "AutomationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Update service boundary guard to validate candidate version ownership
CREATE OR REPLACE FUNCTION automation_config_service_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."activeVersionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AutomationVersion" WHERE id = NEW."activeVersionId" AND "serviceId" = NEW."serviceId") THEN
    RAISE EXCEPTION 'Automation version belongs to another service';
  END IF;
  IF NEW."candidateVersionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AutomationVersion" WHERE id = NEW."candidateVersionId" AND "serviceId" = NEW."serviceId") THEN
    RAISE EXCEPTION 'Candidate automation version belongs to another service';
  END IF;
  IF NEW."draftId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AutomationDraft" WHERE id = NEW."draftId" AND "serviceId" = NEW."serviceId") THEN
    RAISE EXCEPTION 'Automation draft belongs to another service';
  END IF;
  RETURN NEW;
END $$;

-- Preserve historical reference protection for published automation versions (active, candidate, or historical) and incident decisions
CREATE OR REPLACE FUNCTION automation_policy_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AutomationVersionPolicyRef" r WHERE r."escalationPolicyId" = OLD.id)
  OR EXISTS (SELECT 1 FROM "IncidentAutomationDecision" d WHERE d."escalationPolicyId" = OLD.id) THEN
    RAISE EXCEPTION 'Policy is referenced by published automation history or an incident decision';
  END IF;
  RETURN OLD;
END $$;

