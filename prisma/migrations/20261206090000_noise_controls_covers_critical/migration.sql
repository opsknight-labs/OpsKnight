-- Critical and HIGH-urgency alerts page unless a window or rule opts in to covering them.
ALTER TABLE "NoiseMaintenanceWindow" ADD COLUMN "coversCritical" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SuppressionRule" ADD COLUMN "coversCritical" BOOLEAN NOT NULL DEFAULT false;
