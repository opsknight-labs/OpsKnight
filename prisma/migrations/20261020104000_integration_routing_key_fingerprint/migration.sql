ALTER TABLE "Integration"
  ADD COLUMN "keyFingerprint" TEXT,
  ADD COLUMN "previousKeyFingerprint" TEXT;

CREATE UNIQUE INDEX "Integration_keyFingerprint_key" ON "Integration"("keyFingerprint");
CREATE INDEX "Integration_previousKeyFingerprint_idx" ON "Integration"("previousKeyFingerprint");
