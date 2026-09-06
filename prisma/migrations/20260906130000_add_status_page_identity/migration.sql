ALTER TABLE "StatusPage"
ADD COLUMN "slug" TEXT,
ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "StatusPage_slug_key" ON "StatusPage"("slug");
CREATE INDEX "StatusPage_isDefault_enabled_idx" ON "StatusPage"("isDefault", "enabled");

-- Preserve the legacy singleton route deterministically for existing installations.
UPDATE "StatusPage"
SET "isDefault" = true
WHERE "id" = (
  SELECT "id"
  FROM "StatusPage"
  ORDER BY "createdAt" ASC, "id" ASC
  LIMIT 1
);

-- PostgreSQL enforces the one-default-page invariant under concurrent writes.
CREATE UNIQUE INDEX "StatusPage_single_default_key"
ON "StatusPage"("isDefault")
WHERE "isDefault" = true;
