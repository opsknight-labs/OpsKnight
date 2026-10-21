ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'AUDIT_EXPORT';

CREATE TABLE "AuditExport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "filter" JSONB NOT NULL,
  "encryptedPayload" TEXT,
  "checksum" TEXT,
  "sizeBytes" INTEGER,
  "recordCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditExport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AuditExport_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AuditExport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuditExport_jobId_key" ON "AuditExport"("jobId");
CREATE INDEX "AuditExport_apiKeyId_createdAt_idx" ON "AuditExport"("apiKeyId", "createdAt");
CREATE INDEX "AuditExport_expiresAt_idx" ON "AuditExport"("expiresAt");
