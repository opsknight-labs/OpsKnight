ALTER TABLE "IncidentFingerprint"
  ADD COLUMN "lastIndexedAlertId" TEXT,
  ADD COLUMN "lastIndexedAlertAt" TIMESTAMP(3),
  ADD COLUMN "lastModifiedAlertId" TEXT,
  ADD COLUMN "lastModifiedAlertAt" TIMESTAMP(3),
  ADD COLUMN "alertInputDigest" TEXT,
  ADD COLUMN "indexedAlertCount" INTEGER,
  ADD COLUMN "alertNormalizationHash" TEXT;
