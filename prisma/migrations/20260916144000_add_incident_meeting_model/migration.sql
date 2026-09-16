-- CreateEnum
CREATE TYPE "IncidentMeetingProvider" AS ENUM ('MICROSOFT_TEAMS', 'ZOOM', 'GOOGLE_MEET', 'JITSI', 'NONE');

-- CreateEnum
CREATE TYPE "IncidentMeetingState" AS ENUM ('REQUESTED', 'PROVISIONING', 'READY', 'CLOSING', 'CLOSED', 'FAILED');

-- CreateEnum
CREATE TYPE "IncidentMeetingHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "MicrosoftTeamsConfig" ADD COLUMN "defaultMeetingOrganizerUpn" TEXT;

-- CreateTable
CREATE TABLE "IncidentMeeting" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "provider" "IncidentMeetingProvider" NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "state" "IncidentMeetingState" NOT NULL DEFAULT 'REQUESTED',
    "health" "IncidentMeetingHealth" NOT NULL DEFAULT 'HEALTHY',
    "externalId" TEXT NOT NULL,
    "joinUrl" TEXT NOT NULL,
    "joinWebUrl" TEXT,
    "conferenceId" TEXT,
    "tollNumber" TEXT,
    "tollFreeNumber" TEXT,
    "organizerEmail" TEXT,
    "providerMeetingId" TEXT,
    "provisioningToken" TEXT,
    "provisioningStartedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentMeeting_externalId_key" ON "IncidentMeeting"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentMeeting_incidentId_generation_key" ON "IncidentMeeting"("incidentId", "generation");

-- CreateIndex
CREATE INDEX "IncidentMeeting_incidentId_state_idx" ON "IncidentMeeting"("incidentId", "state");

-- CreateIndex
CREATE INDEX "IncidentMeeting_provider_externalId_idx" ON "IncidentMeeting"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "IncidentMeeting" ADD CONSTRAINT "IncidentMeeting_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
