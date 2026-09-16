-- DSAR (Data Subject Access Request) workflow foundation.
-- Adds PrivacyRequest + PrivacyExportArtifact. All status/timestamp writes must
-- go through transitionPrivacyRequest() in application code, not direct SQL.
-- The AuditEntityType enum values these tables rely on were added in the
-- preceding migration (20260916000000_privacy_audit_entity_types).

CREATE TYPE "PrivacyRequestSubjectType" AS ENUM ('USER', 'STATUS_SUBSCRIBER');
CREATE TYPE "PrivacyRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION', 'OBJECTION', 'PORTABILITY');
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('RECEIVED', 'IDENTITY_VERIFICATION', 'IN_REVIEW', 'PROCESSING', 'BLOCKED', 'COMPLETED', 'REJECTED');
CREATE TYPE "PrivacyExportArtifactStatus" AS ENUM ('PENDING', 'READY', 'DOWNLOADED', 'EXPIRED', 'FAILED');

CREATE TABLE "PrivacyRequest" (
  "id" TEXT NOT NULL,
  "subjectType" "PrivacyRequestSubjectType" NOT NULL DEFAULT 'USER',
  "subjectId" TEXT NOT NULL,
  "requestType" "PrivacyRequestType" NOT NULL,
  "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "requestedById" TEXT,
  "assignedToId" TEXT,
  "notes" TEXT,
  "rejectionReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivacyExportArtifact" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "PrivacyExportArtifactStatus" NOT NULL DEFAULT 'PENDING',
  "storageKey" TEXT,
  "encryptedPayload" TEXT,
  "checksum" TEXT,
  "sizeBytes" INTEGER,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastDownloadedAt" TIMESTAMP(3),
  CONSTRAINT "PrivacyExportArtifact_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrivacyExportArtifact" ADD CONSTRAINT "PrivacyExportArtifact_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "PrivacyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PrivacyRequest_subjectType_subjectId_idx" ON "PrivacyRequest"("subjectType", "subjectId");
CREATE INDEX "PrivacyRequest_status_requestType_idx" ON "PrivacyRequest"("status", "requestType");
CREATE INDEX "PrivacyRequest_assignedToId_idx" ON "PrivacyRequest"("assignedToId");
CREATE INDEX "PrivacyRequest_createdAt_idx" ON "PrivacyRequest"("createdAt");

CREATE INDEX "PrivacyExportArtifact_requestId_idx" ON "PrivacyExportArtifact"("requestId");
CREATE INDEX "PrivacyExportArtifact_status_expiresAt_idx" ON "PrivacyExportArtifact"("status", "expiresAt");
