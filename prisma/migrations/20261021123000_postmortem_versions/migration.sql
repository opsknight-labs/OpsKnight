-- Existing records have no recoverable earlier revisions. Seed their current
-- state, then capture every parent-row change from UI, REST, and workers.
CREATE TABLE "PostmortemVersion" (
  "postmortemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostmortemVersion_pkey" PRIMARY KEY ("postmortemId", "revision"),
  CONSTRAINT "PostmortemVersion_postmortemId_fkey" FOREIGN KEY ("postmortemId")
    REFERENCES "Postmortem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PostmortemVersion_postmortemId_createdAt_idx"
  ON "PostmortemVersion"("postmortemId", "createdAt" DESC);

INSERT INTO "PostmortemVersion" ("postmortemId", "revision", "snapshot", "createdAt")
SELECT p."id", p."revision", to_jsonb(p), p."updatedAt" FROM "Postmortem" p;

CREATE FUNCTION "record_postmortem_version"() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "PostmortemVersion" ("postmortemId", "revision", "snapshot")
  VALUES (NEW."id", NEW."revision", to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Postmortem_record_version"
AFTER INSERT OR UPDATE ON "Postmortem"
FOR EACH ROW EXECUTE FUNCTION "record_postmortem_version"();
