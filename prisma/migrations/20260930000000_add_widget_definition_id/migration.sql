-- AlterTable
ALTER TABLE "DashboardWidget" ADD COLUMN "widgetDefinitionId" TEXT;

-- Backfill widgetDefinitionId based on metricKey and config
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'total-incidents' WHERE "metricKey" = 'totalIncidents';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'active-incidents' WHERE "metricKey" = 'activeIncidents';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'mttr' WHERE "metricKey" = 'mttr';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'mtta' WHERE "metricKey" = 'mttd' OR "metricKey" = 'mtta';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'ack-compliance' WHERE "metricKey" = 'ackCompliance';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'resolve-compliance' WHERE "metricKey" = 'resolveCompliance';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'coverage-percent' WHERE "metricKey" = 'coveragePercent';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'ack-rate' WHERE "metricKey" = 'ackRate';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'resolve-rate' WHERE "metricKey" = 'resolveRate';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'ack-breaches' WHERE "metricKey" = 'ackBreaches';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'resolve-breaches' WHERE "metricKey" = 'resolveBreaches';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'escalation-rate' WHERE "metricKey" = 'escalationRate';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'unassigned-active' WHERE "metricKey" = 'unassignedActive';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'high-urgency-rate' WHERE "metricKey" = 'highUrgencyRate';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'after-hours-rate' WHERE "metricKey" = 'afterHoursRate';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'coverage-gaps' WHERE "metricKey" = 'coverageGapDays';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'mtbf' WHERE "metricKey" = 'mtbfMs';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'urgency-distribution' WHERE "metricKey" = 'urgencyMix' OR "metricKey" = 'incidentsByUrgency';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'status-distribution' WHERE "metricKey" = 'statusMix' OR "metricKey" = 'incidentsByStatus';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'incident-heatmap' WHERE "metricKey" = 'heatmapData';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'smart-insights' WHERE "metricKey" = 'insights';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'service-health' WHERE "metricKey" = 'serviceMetrics';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'on-call-load' WHERE "metricKey" = 'onCallLoad';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'top-services' WHERE "metricKey" = 'topServices';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'assignee-load' WHERE "metricKey" = 'assigneeLoad';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'recurring-issues' WHERE "metricKey" = 'recurringTitles';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'service-sla-table' WHERE "metricKey" = 'serviceSlaTable';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'current-on-call' WHERE "metricKey" = 'currentShifts';

UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'mtta-mttr-trend' WHERE "metricKey" = 'trendSeries' AND ("config"->>'chartType') = 'mttaVsMttr';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'sla-compliance-trend' WHERE "metricKey" = 'trendSeries' AND ("config"->>'chartType') = 'slaCompliance';
UPDATE "DashboardWidget" SET "widgetDefinitionId" = 'incident-trend' WHERE "metricKey" = 'trendSeries' AND "widgetDefinitionId" IS NULL;
