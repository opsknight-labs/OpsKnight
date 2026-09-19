-- Encryption migration foundation: runs, per-target checkpoint states, and issues.

CREATE TYPE "EncryptionMigrationMode" AS ENUM ('PREVIEW', 'MIGRATE', 'VERIFY');
CREATE TYPE "EncryptionMigrationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "EncryptionMigrationRun" (
  "id"                           TEXT NOT NULL,
  "mode"                         "EncryptionMigrationMode" NOT NULL DEFAULT 'PREVIEW',
  "status"                       "EncryptionMigrationStatus" NOT NULL DEFAULT 'PENDING',
  "registryFingerprint"          TEXT NOT NULL,
  "activeKeyId"                  TEXT,
  "totalRecords"                 INTEGER NOT NULL DEFAULT 0,
  "processedRecords"             INTEGER NOT NULL DEFAULT 0,
  "migratedRecords"              INTEGER NOT NULL DEFAULT 0,
  "errorRecords"                 INTEGER NOT NULL DEFAULT 0,
  "skippedRecords"               INTEGER NOT NULL DEFAULT 0,
  "conflictRecords"              INTEGER NOT NULL DEFAULT 0,
  "safeForDatabaseKeyRetirement" JSONB DEFAULT '[]',
  "errorMessage"                 TEXT,
  "startedAt"                    TIMESTAMP(3),
  "completedAt"                  TIMESTAMP(3),
  "initiatedById"                TEXT,
  "createdAt"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EncryptionMigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EncryptionMigrationTargetState" (
  "id"             TEXT NOT NULL,
  "runId"          TEXT NOT NULL,
  "targetId"       TEXT NOT NULL,
  "status"         "EncryptionMigrationStatus" NOT NULL DEFAULT 'PENDING',
  "cursor"         TEXT,
  "totalCount"     INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "migratedCount"  INTEGER NOT NULL DEFAULT 0,
  "errorCount"     INTEGER NOT NULL DEFAULT 0,
  "conflictCount"  INTEGER NOT NULL DEFAULT 0,
  "keysDetected"   JSONB DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EncryptionMigrationTargetState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EncryptionMigrationIssue" (
  "id"             TEXT NOT NULL,
  "runId"          TEXT NOT NULL,
  "targetId"       TEXT NOT NULL,
  "recordId"       TEXT NOT NULL,
  "fieldPath"      TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "errorMessage"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EncryptionMigrationIssue_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "EncryptionMigrationRun_status_mode_idx" ON "EncryptionMigrationRun"("status", "mode");
CREATE INDEX "EncryptionMigrationRun_createdAt_idx" ON "EncryptionMigrationRun"("createdAt");
CREATE INDEX "EncryptionMigrationRun_registryFingerprint_idx" ON "EncryptionMigrationRun"("registryFingerprint");

CREATE UNIQUE INDEX "EncryptionMigrationTargetState_runId_targetId_key" ON "EncryptionMigrationTargetState"("runId", "targetId");
CREATE INDEX "EncryptionMigrationTargetState_runId_status_idx" ON "EncryptionMigrationTargetState"("runId", "status");

CREATE INDEX "EncryptionMigrationIssue_runId_targetId_idx" ON "EncryptionMigrationIssue"("runId", "targetId");
CREATE INDEX "EncryptionMigrationIssue_runId_classification_idx" ON "EncryptionMigrationIssue"("runId", "classification");

-- Foreign keys
ALTER TABLE "EncryptionMigrationRun"
  ADD CONSTRAINT "EncryptionMigrationRun_initiatedById_fkey"
  FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EncryptionMigrationTargetState"
  ADD CONSTRAINT "EncryptionMigrationTargetState_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "EncryptionMigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EncryptionMigrationIssue"
  ADD CONSTRAINT "EncryptionMigrationIssue_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "EncryptionMigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
