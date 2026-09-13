CREATE TYPE "WarRoomProvider" AS ENUM ('SLACK', 'MICROSOFT_TEAMS');
CREATE TYPE "WarRoomState" AS ENUM ('PROVISIONING', 'READY', 'CLOSING', 'CLOSED', 'ARCHIVED', 'FAILED', 'AMBIGUOUS');
CREATE TYPE "WarRoomMembershipType" AS ENUM ('STANDARD', 'PRIVATE');
CREATE TYPE "WarRoomParticipantSource" AS ENUM ('ASSIGNEE', 'WATCHER', 'ESCALATION', 'TEAM', 'MANUAL');
CREATE TYPE "WarRoomParticipantState" AS ENUM ('DESIRED', 'PROCESSING', 'PRESENT', 'SKIPPED', 'FAILED', 'REMOVED');
ALTER TABLE "MicrosoftTeamsConfig"
  ADD COLUMN "warRoomsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultWarRoomMembershipType" "WarRoomMembershipType" NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "MicrosoftTeamsDestination"
  ADD COLUMN "warRoomEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "warRoomAutoCreate" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "warRoomMembershipType" "WarRoomMembershipType";

ALTER TABLE "Service"
  ADD COLUMN "microsoftTeamsWarRoomAutoCreate" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "IncidentWarRoom" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "provider" "WarRoomProvider" NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "state" "WarRoomState" NOT NULL DEFAULT 'PROVISIONING',
  "destinationId" TEXT,
  "installationId" TEXT,
  "providerTenantId" TEXT,
  "providerContainerId" TEXT,
  "providerChannelId" TEXT,
  "providerChannelName" TEXT,
  "providerChannelUrl" TEXT,
  "membershipType" "WarRoomMembershipType",
  "commandMessageId" TEXT,
  "commandConversationId" TEXT,
  "messageGeneration" INTEGER NOT NULL DEFAULT 1,
  "provisioningToken" TEXT,
  "provisioningStartedAt" TIMESTAMP(3),
  "createAttemptedAt" TIMESTAMP(3),
  "createOperationId" TEXT,
  "readyAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastErrorCode" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentWarRoom_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncidentWarRoom_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WarRoomParticipant" (
  "id" TEXT NOT NULL,
  "warRoomId" TEXT NOT NULL,
  "userId" TEXT,
  "providerUserId" TEXT,
  "providerObjectId" TEXT,
  "source" "WarRoomParticipantSource" NOT NULL,
  "state" "WarRoomParticipantState" NOT NULL DEFAULT 'DESIRED',
  "lastError" TEXT,
  "addedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarRoomParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WarRoomParticipant_warRoomId_fkey" FOREIGN KEY ("warRoomId") REFERENCES "IncidentWarRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WarRoomParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "IncidentWarRoom_incidentId_provider_generation_key" ON "IncidentWarRoom"("incidentId", "provider", "generation");
CREATE INDEX "IncidentWarRoom_incidentId_provider_state_idx" ON "IncidentWarRoom"("incidentId", "provider", "state");
CREATE INDEX "IncidentWarRoom_provider_providerTenantId_providerContainerId_providerChannelId_idx" ON "IncidentWarRoom"("provider", "providerTenantId", "providerContainerId", "providerChannelId");
CREATE INDEX "IncidentWarRoom_state_provisioningStartedAt_idx" ON "IncidentWarRoom"("state", "provisioningStartedAt");
CREATE UNIQUE INDEX "IncidentWarRoom_provider_tenant_team_channel_unique" ON "IncidentWarRoom"("provider", "providerTenantId", "providerContainerId", "providerChannelId") WHERE "providerChannelId" IS NOT NULL;
CREATE UNIQUE INDEX "WarRoomParticipant_warRoomId_userId_unique" ON "WarRoomParticipant"("warRoomId", "userId") WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "WarRoomParticipant_warRoomId_providerObjectId_unique" ON "WarRoomParticipant"("warRoomId", "providerObjectId") WHERE "providerObjectId" IS NOT NULL;
CREATE UNIQUE INDEX "WarRoomParticipant_warRoomId_providerUserId_unique" ON "WarRoomParticipant"("warRoomId", "providerUserId") WHERE "providerUserId" IS NOT NULL;
CREATE INDEX "WarRoomParticipant_warRoomId_state_idx" ON "WarRoomParticipant"("warRoomId", "state");
CREATE INDEX "WarRoomParticipant_userId_idx" ON "WarRoomParticipant"("userId");
