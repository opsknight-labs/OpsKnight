-- Phase 3 collaboration state is additive and provider-neutral. It lets
-- workers coalesce command-card projections and distinguish room lifecycle
-- from external provider health.
-- Keep PROCESSING while old workers may still emit it. New collaboration
-- workers use PENDING; cleanup can happen only after old binaries are gone.
ALTER TYPE "WarRoomParticipantState" ADD VALUE 'PENDING';
ALTER TYPE "JobType" ADD VALUE 'WAR_ROOM_PARTICIPANT_SYNC';
ALTER TYPE "JobType" ADD VALUE 'WAR_ROOM_PROJECT';

CREATE TYPE "WarRoomHealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'MISSING', 'PERMISSION_ERROR');

ALTER TABLE "IncidentWarRoom"
  ADD COLUMN "projectionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastProjectedAt" TIMESTAMP(3),
  ADD COLUMN "projectionLeaseToken" TEXT,
  ADD COLUMN "projectionLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "commandCreateAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "health" "WarRoomHealthState" NOT NULL DEFAULT 'HEALTHY',
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

ALTER TABLE "WarRoomParticipant"
  ADD COLUMN "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" TEXT;

CREATE INDEX "IncidentWarRoom_provider_health_lastReconciledAt_idx"
  ON "IncidentWarRoom"("provider", "health", "lastReconciledAt");
