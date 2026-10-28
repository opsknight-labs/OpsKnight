-- Per-statement grant count lets concurrent callers share an atomic quota write.
ALTER TABLE "IngestionQuota" ADD COLUMN "lastGranted" INTEGER NOT NULL DEFAULT 0;
