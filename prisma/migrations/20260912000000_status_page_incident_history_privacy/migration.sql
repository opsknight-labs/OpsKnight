-- Add incident history detail redaction window controls
ALTER TABLE "StatusPage" ADD COLUMN IF NOT EXISTS "showIncidentHistoryDetails" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StatusPage" ADD COLUMN IF NOT EXISTS "incidentHistoryDetailDays" INTEGER NOT NULL DEFAULT 7;
