ALTER TABLE "Integration"
  ADD COLUMN "previousKey" TEXT,
  ADD COLUMN "previousKeyExpiresAt" TIMESTAMP(3);
