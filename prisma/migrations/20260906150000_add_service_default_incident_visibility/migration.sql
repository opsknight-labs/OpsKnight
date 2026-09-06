-- AlterTable
ALTER TABLE "Service"
ADD COLUMN "defaultIncidentVisibility" "IncidentVisibility" NOT NULL DEFAULT 'PUBLIC';
