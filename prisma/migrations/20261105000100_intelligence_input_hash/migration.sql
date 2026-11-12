ALTER TABLE "IncidentFingerprint" ADD COLUMN "analysisInputHash" TEXT;
ALTER TABLE "IntelligenceWorkItem" ADD COLUMN "force" BOOLEAN NOT NULL DEFAULT false;
