-- Phase 3 collaboration state is additive and provider-neutral. It lets
-- workers coalesce command-card projections and distinguish room lifecycle
-- from external provider health.
ALTER TYPE "WarRoomParticipantState" RENAME VALUE 'PROCESSING' TO 'PENDING';

CREATE TYPE "WarRoomHealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'MISSING', 'PERMISSION_ERROR');

ALTER TABLE "IncidentWarRoom"
  ADD COLUMN "projectionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastProjectedAt" TIMESTAMP(3),
  ADD COLUMN "health" "WarRoomHealthState" NOT NULL DEFAULT 'HEALTHY',
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

ALTER TABLE "WarRoomParticipant"
  ADD COLUMN "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" TEXT;

CREATE INDEX "IncidentWarRoom_provider_health_lastReconciledAt_idx"
  ON "IncidentWarRoom"("provider", "health", "lastReconciledAt");
