-- Unified ChatOps: durable per-provider delivery + stage settlement for war-room provider events.
-- Survives COMPLETED across provider fan-out; prevents duplicate Slack side-effects.
CREATE TYPE "WarRoomProviderEventDeliveryStatus" AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED');
CREATE TYPE "WarRoomProviderEventStageStatus" AS ENUM ('PENDING','COMPLETED','FAILED','SKIPPED');

CREATE TABLE IF NOT EXISTS "WarRoomProviderEventDelivery" (
  "id" text PRIMARY KEY,
  "provider" "WarRoomProvider" NOT NULL,
  "idempotencyKey" text NOT NULL,
  "incidentId" text NOT NULL,
  "kind" text NOT NULL,
  "eventPayload" jsonb NOT NULL,
  "status" "WarRoomProviderEventDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "leaseToken" text,
  "leaseExpiresAt" timestamp(3),
  "completedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WarRoomProviderEventDelivery_provider_idempotencyKey_key" ON "WarRoomProviderEventDelivery"("provider","idempotencyKey");
CREATE INDEX IF NOT EXISTS "WarRoomProviderEventDelivery_status_leaseExpiresAt_idx" ON "WarRoomProviderEventDelivery"("status","leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "WarRoomProviderEventDelivery_incidentId_kind_idx" ON "WarRoomProviderEventDelivery"("incidentId","kind");
CREATE INDEX IF NOT EXISTS "WarRoomProviderEventDelivery_provider_status_idx" ON "WarRoomProviderEventDelivery"("provider","status");

CREATE TABLE IF NOT EXISTS "WarRoomProviderEventStage" (
  "id" text PRIMARY KEY,
  "deliveryId" text NOT NULL REFERENCES "WarRoomProviderEventDelivery"("id") ON DELETE CASCADE,
  "stage" text NOT NULL,
  "status" "WarRoomProviderEventStageStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text,
  "completedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WarRoomProviderEventStage_deliveryId_stage_key" ON "WarRoomProviderEventStage"("deliveryId","stage");
CREATE INDEX IF NOT EXISTS "WarRoomProviderEventStage_deliveryId_idx" ON "WarRoomProviderEventStage"("deliveryId");
