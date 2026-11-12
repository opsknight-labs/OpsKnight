CREATE TABLE "IntelligenceAnalysisSnapshot" (
  "incidentId" TEXT NOT NULL,
  "kind" "IntelligenceFindingKind" NOT NULL,
  "generation" INTEGER NOT NULL,
  "policyVersion" INTEGER,
  "policyHash" TEXT,
  "sourceUpdatedAt" TIMESTAMP(3),
  "fingerprintUpdatedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "engineVersion" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "IntelligenceAnalysisSnapshot_pkey" PRIMARY KEY ("incidentId", "kind"),
  CONSTRAINT "IntelligenceAnalysisSnapshot_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IntelligenceAnalysisSnapshot_nonnegative_rows" CHECK ("rowCount" >= 0)
);
