-- CreateEnum
CREATE TYPE "DependencyEventState" AS ENUM ('ACTIVE', 'SUGGESTED', 'REJECTED', 'REMOVED');
CREATE TYPE "GraphViewVisibility" AS ENUM ('PRIVATE', 'TEAM', 'ORG');

-- CreateTable
CREATE TABLE "ServiceDependencyEvent" (
    "id" TEXT NOT NULL,
    "upstreamServiceId" TEXT NOT NULL,
    "downstreamServiceId" TEXT NOT NULL,
    "state" "DependencyEventState" NOT NULL,
    "origin" "DependencyOrigin" NOT NULL,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceDependencyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceDependencyEvent_occurredAt_idx" ON "ServiceDependencyEvent"("occurredAt");
CREATE INDEX "ServiceDependencyEvent_upstreamServiceId_downstreamServiceId_occurredAt_idx" ON "ServiceDependencyEvent"("upstreamServiceId", "downstreamServiceId", "occurredAt");

CREATE TABLE "ServiceDependencyEdgeStats" (
    "id" TEXT NOT NULL,
    "upstreamServiceId" TEXT NOT NULL,
    "downstreamServiceId" TEXT NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceDependencyEdgeStats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceDependencyEdgeStats_upstreamServiceId_downstreamServiceId_source_windowStart_key" ON "ServiceDependencyEdgeStats"("upstreamServiceId", "downstreamServiceId", "source", "windowStart");
CREATE INDEX "ServiceDependencyEdgeStats_upstreamServiceId_downstreamServiceId_windowStart_idx" ON "ServiceDependencyEdgeStats"("upstreamServiceId", "downstreamServiceId", "windowStart");
CREATE INDEX "ServiceDependencyEdgeStats_windowStart_idx" ON "ServiceDependencyEdgeStats"("windowStart");

CREATE TABLE "SavedGraphView" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "teamId" TEXT,
    "visibility" "GraphViewVisibility" NOT NULL DEFAULT 'PRIVATE',
    "config" JSONB NOT NULL,
    "shareTokenHash" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "shareRevokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedGraphView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedGraphView_shareTokenHash_key" ON "SavedGraphView"("shareTokenHash");
CREATE INDEX "SavedGraphView_ownerId_idx" ON "SavedGraphView"("ownerId");
CREATE INDEX "SavedGraphView_visibility_teamId_idx" ON "SavedGraphView"("visibility", "teamId");

-- Backfill: one event per existing edge at its creation time. Approximate: earlier transitions
-- (suggested then approved) are unknown, so a current ACTIVE edge is replayed as active since createdAt.
INSERT INTO "ServiceDependencyEvent" ("id", "upstreamServiceId", "downstreamServiceId", "state", "origin", "occurredAt")
SELECT 'bf_' || "id", "upstreamServiceId", "downstreamServiceId",
       CASE "status" WHEN 'ACTIVE' THEN 'ACTIVE'::"DependencyEventState"
                     WHEN 'SUGGESTED' THEN 'SUGGESTED'::"DependencyEventState"
                     ELSE 'REJECTED'::"DependencyEventState" END,
       "origin", "createdAt"
FROM "ServiceDependency";
