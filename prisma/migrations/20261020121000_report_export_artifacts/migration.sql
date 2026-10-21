CREATE TABLE "ReportExport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "query" JSONB NOT NULL,
  "encryptedPayload" TEXT,
  "checksum" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportExport_jobId_key" ON "ReportExport"("jobId");
CREATE INDEX "ReportExport_userId_createdAt_idx" ON "ReportExport"("userId", "createdAt");
CREATE INDEX "ReportExport_expiresAt_idx" ON "ReportExport"("expiresAt");
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
