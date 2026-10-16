-- Runbook ownership and tags for library filtering.
ALTER TABLE "Runbook" ADD COLUMN IF NOT EXISTS "ownerTeamId" TEXT;
ALTER TABLE "Runbook" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Runbook_ownerTeamId_fkey') THEN
    ALTER TABLE "Runbook" ADD CONSTRAINT "Runbook_ownerTeamId_fkey"
      FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Runbook_ownerTeamId_idx" ON "Runbook"("ownerTeamId");
CREATE INDEX IF NOT EXISTS "Runbook_tags_idx" ON "Runbook" USING GIN ("tags");
