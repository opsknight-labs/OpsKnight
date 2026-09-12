-- Depends on 20260914100000_microsoft_teams_enum_extend for enum values.
-- Microsoft Teams Phase 1 foundation
-- Encrypted console-UI config, team/channel install destinations, and incident message ledger for Adaptive Card updates.
-- Naming uses MicrosoftTeams* to avoid collision with the internal Team domain.

-- New enums
CREATE TYPE "MicrosoftTeamsTenantMode" AS ENUM ('SINGLE', 'MULTI');

-- MicrosoftTeamsConfig (console UI, encrypted clientSecret)
CREATE TABLE IF NOT EXISTS "MicrosoftTeamsConfig" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "clientSecret" TEXT NOT NULL,
  "tenantId" TEXT,
  "tenantMode" "MicrosoftTeamsTenantMode" NOT NULL DEFAULT 'SINGLE',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "MicrosoftTeamsConfig_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsConfig_enabled_idx" ON "MicrosoftTeamsConfig"("enabled");

-- MicrosoftTeamsInstallation (verified tenantId+teamId, never trusted from raw JSON)
CREATE TABLE IF NOT EXISTS "MicrosoftTeamsInstallation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "teamName" TEXT,
  "channelId" TEXT,
  "installedBy" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MicrosoftTeamsInstallation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftTeamsInstallation_tenantId_teamId_key" ON "MicrosoftTeamsInstallation"("tenantId", "teamId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsInstallation_tenantId_idx" ON "MicrosoftTeamsInstallation"("tenantId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsInstallation_teamId_idx" ON "MicrosoftTeamsInstallation"("teamId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsInstallation_enabled_idx" ON "MicrosoftTeamsInstallation"("enabled");

-- MicrosoftTeamsDestination (one Teams channel per OpsKnight service in Phase 1)
CREATE TABLE IF NOT EXISTS "MicrosoftTeamsDestination" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "channelName" TEXT,
  "teamName" TEXT,
  "installationId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "MicrosoftTeamsDestination_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_serviceId_key" ON "MicrosoftTeamsDestination"("serviceId");
CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_tenantId_teamId_channelId_key" ON "MicrosoftTeamsDestination"("tenantId", "teamId", "channelId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_tenantId_teamId_idx" ON "MicrosoftTeamsDestination"("tenantId", "teamId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_channelId_idx" ON "MicrosoftTeamsDestination"("channelId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_installationId_idx" ON "MicrosoftTeamsDestination"("installationId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsDestination_enabled_idx" ON "MicrosoftTeamsDestination"("enabled");

-- MicrosoftTeamsIncidentMessage (idempotency + update path for incident cards)
CREATE TABLE IF NOT EXISTS "MicrosoftTeamsIncidentMessage" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "conversationId" TEXT,
  "messageId" TEXT,
  "channelId" TEXT,
  "tenantId" TEXT,
  "teamId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MicrosoftTeamsIncidentMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftTeamsIncidentMessage_incidentId_destinationId_key" ON "MicrosoftTeamsIncidentMessage"("incidentId", "destinationId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsIncidentMessage_incidentId_idx" ON "MicrosoftTeamsIncidentMessage"("incidentId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsIncidentMessage_destinationId_idx" ON "MicrosoftTeamsIncidentMessage"("destinationId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsIncidentMessage_conversationId_idx" ON "MicrosoftTeamsIncidentMessage"("conversationId");
CREATE INDEX IF NOT EXISTS "MicrosoftTeamsIncidentMessage_messageId_idx" ON "MicrosoftTeamsIncidentMessage"("messageId");

-- Foreign keys (IF NOT EXISTS via DO block for idempotency)
DO $$ BEGIN
  ALTER TABLE "MicrosoftTeamsConfig" ADD CONSTRAINT "MicrosoftTeamsConfig_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "MicrosoftTeamsInstallation" ADD CONSTRAINT "MicrosoftTeamsInstallation_installedBy_fkey" FOREIGN KEY ("installedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "MicrosoftTeamsDestination" ADD CONSTRAINT "MicrosoftTeamsDestination_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "MicrosoftTeamsDestination" ADD CONSTRAINT "MicrosoftTeamsDestination_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "MicrosoftTeamsInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "MicrosoftTeamsDestination" ADD CONSTRAINT "MicrosoftTeamsDestination_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "MicrosoftTeamsIncidentMessage" ADD CONSTRAINT "MicrosoftTeamsIncidentMessage_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "MicrosoftTeamsIncidentMessage" ADD CONSTRAINT "MicrosoftTeamsIncidentMessage_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "MicrosoftTeamsDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
