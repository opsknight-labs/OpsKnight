-- Retention holds foundation: DataRetentionHold table + SystemSettings lifecycle columns.

CREATE TYPE "RetentionHoldScopeType" AS ENUM ('USER', 'INCIDENT', 'PRIVACY_REQUEST');

CREATE TABLE "DataRetentionHold" (
  "id"                TEXT NOT NULL,
  "scopeType"         "RetentionHoldScopeType" NOT NULL,
  "scopeId"           TEXT NOT NULL,
  "reason"            TEXT NOT NULL,
  "externalReference" TEXT,
  "createdById"       TEXT,
  "releasedById"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "expiresAt"         TIMESTAMP(3),
  "releasedAt"        TIMESTAMP(3),

  CONSTRAINT "DataRetentionHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataRetentionHold_scopeType_scopeId_idx" ON "DataRetentionHold"("scopeType", "scopeId");
CREATE INDEX "DataRetentionHold_scopeType_scopeId_releasedAt_idx" ON "DataRetentionHold"("scopeType", "scopeId", "releasedAt");
CREATE INDEX "DataRetentionHold_expiresAt_releasedAt_idx" ON "DataRetentionHold"("expiresAt", "releasedAt");
CREATE INDEX "DataRetentionHold_createdAt_idx" ON "DataRetentionHold"("createdAt");

ALTER TABLE "DataRetentionHold"
  ADD CONSTRAINT "DataRetentionHold_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DataRetentionHold"
  ADD CONSTRAINT "DataRetentionHold_releasedById_fkey"
  FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New lifecycle retention columns for SystemSettings
ALTER TABLE "SystemSettings"
  ADD COLUMN "completedPrivacyRequestRetentionDays" INTEGER NOT NULL DEFAULT 730;

ALTER TABLE "SystemSettings"
  ADD COLUMN "expiredPrivacyArtifactRetentionDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "SystemSettings"
  ADD COLUMN "unsubscribedSubscriberRetentionDays" INTEGER NOT NULL DEFAULT 30;