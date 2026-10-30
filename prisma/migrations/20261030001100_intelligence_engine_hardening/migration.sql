BEGIN;

-- Work item generations come from one sequence, so they only ever increase. A finished item is deleted;
-- when the same incident is signalled again its new item must still outrank every finding written before,
-- otherwise the generation fence on findings would discard the newer analysis as stale.
CREATE SEQUENCE IF NOT EXISTS "IntelligenceWorkItem_generation_seq" AS integer;
SELECT setval('"IntelligenceWorkItem_generation_seq"',
  GREATEST(
    COALESCE((SELECT max("generation") FROM "IntelligenceWorkItem"), 0),
    COALESCE((SELECT max("generation") FROM "IntelligenceFinding"), 0),
    1
  ));

-- When an item exhausted its attempts. A dead letter that is signalled again after a cool-down gets a fresh
-- set of attempts, so a database outage cannot permanently stop work on the incidents it touched.
ALTER TABLE "IntelligenceWorkItem" ADD COLUMN "failedAt" TIMESTAMP(3);

-- Claims scan only live, unleased work; dead letters no longer sit in the claim path.
DROP INDEX IF EXISTS "idx_intelligence_work_item_unleased";
CREATE INDEX "idx_intelligence_work_item_unleased" ON "IntelligenceWorkItem" ("priority", "scheduledAt")
  WHERE "claimToken" IS NULL AND "attempts" < 8;
CREATE INDEX "idx_intelligence_work_item_dead" ON "IntelligenceWorkItem" ("failedAt")
  WHERE "attempts" >= 8;

-- Hash of the masked template, written by the indexer. Finding incidents whose vector is out of date is
-- then an indexed comparison instead of hashing every recent template on every pass.
ALTER TABLE "IncidentFingerprint" ADD COLUMN "templateHash" TEXT;

-- Superseded findings are kept only briefly; retention finds them by status and age.
CREATE INDEX "idx_intelligence_finding_superseded" ON "IntelligenceFinding" ("status", "supersededAt");

-- Rule learning reads recent human decisions by update time.
CREATE INDEX "idx_incident_relationship_updated" ON "IncidentRelationship" ("updatedAt");

COMMIT;
