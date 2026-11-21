ALTER TABLE "IncidentFingerprint" ADD COLUMN "patternVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IntelligencePattern" ADD COLUMN "resolutionTotalMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "stats" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ChangeEvent" ADD COLUMN "component" TEXT, ADD COLUMN "labels" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "idx_incident_fingerprint_problem" ON "IncidentFingerprint" ("serviceId", "template", "incidentCreatedAt");
CREATE INDEX "idx_change_event_source_recent" ON "ChangeEvent" ("source", "occurredAt");
ALTER TABLE "IntelligencePattern" ADD CONSTRAINT "intelligence_pattern_counts_nonnegative"
  CHECK ("support" >= 0 AND "successes" >= 0 AND "failures" >= 0 AND "resolutionTotalMs" >= 0);
