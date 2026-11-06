-- Intelligence-owned derived data only. No ALTER or trigger on Incident or Alert.
CREATE TABLE "AlertFingerprint" (
  "alertId" TEXT PRIMARY KEY REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "incidentId" TEXT NOT NULL REFERENCES "IncidentFingerprint"("incidentId") ON DELETE CASCADE ON UPDATE CASCADE,
  "serviceId" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  "templateHash" TEXT,
  "tokens" TEXT[] NOT NULL,
  "labels" JSONB NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "alertCreatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AlertFingerprint_incidentId_idx" ON "AlertFingerprint"("incidentId");
CREATE INDEX "idx_alert_fingerprint_match" ON "AlertFingerprint"("serviceId", "templateHash", "alertCreatedAt" DESC);
