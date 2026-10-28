CREATE TABLE "IngestionQuota" (
  "key" TEXT PRIMARY KEY,
  "tokens" DOUBLE PRECISION NOT NULL CHECK ("tokens" >= 0),
  "rate" INTEGER NOT NULL CHECK ("rate" BETWEEN 1 AND 10000000),
  "burst" INTEGER NOT NULL CHECK ("burst" BETWEEN 1 AND 10000000),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastAllowed" BOOLEAN NOT NULL,
  "policyRevision" BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX "IngestionQuota_updatedAt_idx" ON "IngestionQuota" ("updatedAt");
