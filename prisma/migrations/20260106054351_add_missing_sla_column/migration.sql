/*
  Warnings:

  - Made the column `incidentRetentionDays` on table `SystemSettings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `alertRetentionDays` on table `SystemSettings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `logRetentionDays` on table `SystemSettings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `metricsRetentionDays` on table `SystemSettings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `realTimeWindowDays` on table `SystemSettings` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "IncidentMetricRollup" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "serviceNotifyOnSlaBreach" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SystemSettings" ALTER COLUMN "incidentRetentionDays" SET NOT NULL,
ALTER COLUMN "alertRetentionDays" SET NOT NULL,
ALTER COLUMN "logRetentionDays" SET NOT NULL,
ALTER COLUMN "metricsRetentionDays" SET NOT NULL,
ALTER COLUMN "realTimeWindowDays" SET NOT NULL;
