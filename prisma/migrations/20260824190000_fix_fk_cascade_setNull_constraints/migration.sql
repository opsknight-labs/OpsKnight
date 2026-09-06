-- Fix foreign key cascade and SetNull constraints for enterprise data integrity.
-- This migration ensures:
--   1. Services with incident history cannot be deleted; auxiliary service data cascades.
--   2. Deleting a User does NOT destroy historical IncidentNotes (userId is nullified instead).
--   3. Deleting a User nullifies team lead, postmortem author, template author, action item owner, etc.

-- IncidentNote.userId: make nullable so notes survive user deletion
ALTER TABLE "IncidentNote" ALTER COLUMN "userId" DROP NOT NULL;

-- Postmortem.createdById: make nullable
ALTER TABLE "Postmortem" ALTER COLUMN "createdById" DROP NOT NULL;

-- IncidentTemplate.createdById: make nullable
ALTER TABLE "IncidentTemplate" ALTER COLUMN "createdById" DROP NOT NULL;

-- SlackOAuthConfig.updatedBy: make nullable
ALTER TABLE "SlackOAuthConfig" ALTER COLUMN "updatedBy" DROP NOT NULL;

-- Drop existing FK constraints so we can re-add with onDelete rules

-- Incident → Service: Restrict to preserve incident and audit history
ALTER TABLE "Incident" DROP CONSTRAINT IF EXISTS "Incident_serviceId_fkey";
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Alert → Service: Cascade
ALTER TABLE "Alert" DROP CONSTRAINT IF EXISTS "Alert_serviceId_fkey";
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integration → Service: Cascade
ALTER TABLE "Integration" DROP CONSTRAINT IF EXISTS "Integration_serviceId_fkey";
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Team.teamLeadId → User: SetNull
ALTER TABLE "Team" DROP CONSTRAINT IF EXISTS "Team_teamLeadId_fkey";
ALTER TABLE "Team" ADD CONSTRAINT "Team_teamLeadId_fkey"
  FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- IncidentNote.userId → User: SetNull
ALTER TABLE "IncidentNote" DROP CONSTRAINT IF EXISTS "IncidentNote_userId_fkey";
ALTER TABLE "IncidentNote" ADD CONSTRAINT "IncidentNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Postmortem.createdById → User: SetNull
ALTER TABLE "Postmortem" DROP CONSTRAINT IF EXISTS "Postmortem_createdById_fkey";
ALTER TABLE "Postmortem" ADD CONSTRAINT "Postmortem_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- IncidentTemplate.createdById → User: SetNull
ALTER TABLE "IncidentTemplate" DROP CONSTRAINT IF EXISTS "IncidentTemplate_createdById_fkey";
ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "IncidentTemplate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ActionItem.ownerId → User: SetNull (already nullable, just update FK rule)
ALTER TABLE "ActionItem" DROP CONSTRAINT IF EXISTS "ActionItem_ownerId_fkey";
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SlackOAuthConfig.updatedBy → User: SetNull
ALTER TABLE "SlackOAuthConfig" DROP CONSTRAINT IF EXISTS "SlackOAuthConfig_updatedBy_fkey";
ALTER TABLE "SlackOAuthConfig" ADD CONSTRAINT "SlackOAuthConfig_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
