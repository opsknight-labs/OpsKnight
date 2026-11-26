import 'server-only';

import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { buildCsv } from '@/lib/csv';
import { AppError } from '@/lib/errors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { buildEnhancedUptimePdf } from '@/lib/status-pages/reports/uptime-report-generator';
import { businessServiceReadWhere } from './commands';
import { canReadBusinessServiceFinancials } from './financials';
import { estimateDowntimeCostCents } from './impact-cost';
import { getBusinessServiceStats, getImpactTimeline } from './stats';

const MINUTE = 60_000;

/** `month=YYYY-MM` (UTC), default the current month; never in the future, at most 13 months back. */
export const SlaReportQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.')
      .optional(),
  })
  .strict();

export type SlaReport = {
  businessServiceId: string;
  name: string;
  month: string;
  from: Date;
  to: Date;
  /** The month is still running; figures cover it up to now. */
  monthToDate: boolean;
  uptimePercent: number;
  weightedUptimePercent: number;
  downtimeMinutes: number;
  weightedDowntimeMinutes: number;
  sloTarget: number | null;
  /** Severity-weighted uptime against the SLO target; null without an SLO. */
  sloMet: boolean | null;
  incidentCount: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
  /** Readable incidents only; others count in the totals but are not listed. */
  incidents: Array<{
    id: string;
    title: string;
    urgency: string | null;
    source: string;
    impactStartedAt: Date;
    impactEndedAt: Date | null;
    impactMinutes: number;
  }>;
  /** Present only for actors who may read business-service financials. */
  estimatedCostCents?: number | null;
  currency?: string;
};

export function monthWindow(month: string | undefined, now = new Date()) {
  const key = month ?? now.toISOString().slice(0, 7);
  const from = new Date(`${key}-01T00:00:00Z`);
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const earliest = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 1);
  if (from.getTime() > now.getTime() || from.getTime() < earliest)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'The month must be within the last 13 months.',
    });
  return { month: key, from, to: end, monthToDate: end.getTime() > now.getTime() };
}

/** Monthly SLA figures of one business service, inside the actor's read scope. */
export async function getBusinessServiceSlaReport(
  businessServiceId: string,
  month: string | undefined,
  actor: AuthorizationActor,
  now = new Date()
): Promise<SlaReport> {
  const window = monthWindow(month, now);
  const row = await prisma.businessService.findFirst({
    where: { AND: [{ id: businessServiceId }, businessServiceReadWhere(actor)] },
    select: { id: true, name: true, sloTarget: true, revenuePerHourCents: true, currency: true },
  });
  if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const range = { from: window.from, to: window.to };
  const [stats, timeline] = await Promise.all([
    getBusinessServiceStats(row.id, range, actor),
    getImpactTimeline(row.id, range, actor),
  ]);
  const until = Math.min(window.to.getTime(), now.getTime());
  const report: SlaReport = {
    businessServiceId: row.id,
    name: row.name,
    ...window,
    uptimePercent: stats.uptimePercent,
    weightedUptimePercent: stats.weightedUptimePercent ?? stats.uptimePercent,
    downtimeMinutes: stats.impactMinutes,
    weightedDowntimeMinutes: stats.weightedDowntimeMinutes ?? stats.impactMinutes,
    sloTarget: row.sloTarget,
    sloMet:
      row.sloTarget === null
        ? null
        : (stats.weightedUptimePercent ?? stats.uptimePercent) >= row.sloTarget,
    incidentCount: stats.incidentCount,
    mttaMinutes: stats.mttaMinutes,
    mttrMinutes: stats.mttrMinutes,
    incidents: timeline.flatMap(entry =>
      entry.excluded || entry.incidentId === null
        ? []
        : [
            {
              id: entry.incidentId,
              title: entry.incidentTitle ?? '',
              urgency: entry.urgency,
              source: entry.source,
              impactStartedAt: entry.startedAt,
              impactEndedAt: entry.endedAt,
              impactMinutes:
                Math.max(
                  0,
                  Math.min(entry.endedAt?.getTime() ?? until, until) -
                    Math.max(entry.startedAt.getTime(), window.from.getTime())
                ) / MINUTE,
            },
          ]
    ),
  };
  if (canReadBusinessServiceFinancials(actor)) {
    report.estimatedCostCents = estimateDowntimeCostCents(
      report.weightedDowntimeMinutes,
      row.revenuePerHourCents
    );
    report.currency = row.currency;
  }
  return report;
}

const fixed = (value: number | null, digits = 3) => (value === null ? '' : value.toFixed(digits));

export function slaReportCsv(report: SlaReport): string {
  const summary: Array<[string, string | number]> = [
    ['Business service', report.name],
    ['Month', `${report.month}${report.monthToDate ? ' (month to date)' : ''}`],
    ['Uptime %', fixed(report.uptimePercent)],
    ['Severity-weighted uptime %', fixed(report.weightedUptimePercent)],
    ['SLO target %', fixed(report.sloTarget)],
    ['SLO', report.sloMet === null ? 'No SLO' : report.sloMet ? 'Met' : 'Missed'],
    ['Downtime minutes', fixed(report.downtimeMinutes, 1)],
    ['Severity-weighted downtime minutes', fixed(report.weightedDowntimeMinutes, 1)],
    ['Incidents', report.incidentCount],
    ['MTTA minutes', fixed(report.mttaMinutes, 1)],
    ['MTTR minutes', fixed(report.mttrMinutes, 1)],
  ];
  if (report.currency !== undefined)
    summary.push([
      `Estimated downtime cost (${report.currency})`,
      report.estimatedCostCents == null ? '' : (report.estimatedCostCents / 100).toFixed(2),
    ]);
  const head = buildCsv(
    summary.map(([metric, value]) => ({ metric, value })),
    [
      { key: 'metric', header: 'Metric' },
      { key: 'value', header: 'Value' },
    ]
  );
  const incidents = buildCsv(
    report.incidents.map(incident => ({
      ...incident,
      impactStartedAt: incident.impactStartedAt.toISOString(),
      impactEndedAt: incident.impactEndedAt?.toISOString() ?? '',
      impactMinutes: incident.impactMinutes.toFixed(1),
    })),
    [
      { key: 'id', header: 'Incident id' },
      { key: 'title', header: 'Title' },
      { key: 'urgency', header: 'Urgency' },
      { key: 'source', header: 'Impact source' },
      { key: 'impactStartedAt', header: 'Impact started (UTC)' },
      { key: 'impactEndedAt', header: 'Impact ended (UTC)' },
      { key: 'impactMinutes', header: 'Impact minutes in month' },
    ]
  );
  return `${head}\r\n${incidents.replace(/^﻿/, '')}`;
}

/** The report through the status-page uptime PDF layout: one row for the business service. */
export function slaReportPdf(report: SlaReport): Buffer {
  const target = report.sloTarget ?? 0;
  return buildEnhancedUptimePdf({
    pageId: report.businessServiceId,
    pageName: report.name,
    organizationName: report.name,
    periodStart: report.from,
    periodEnd: report.to,
    periodLabel: report.month,
    isMonthToDate: report.monthToDate,
    generatedAt: new Date(),
    uptimeExcellentThreshold: target,
    uptimeGoodThreshold: target,
    visibility: {
      showServices: true,
      showServiceRegion: false,
      showIncidents: true,
      showIncidentTitle: true,
      showIncidentDescription: false,
      showAffectedService: false,
      showIncidentTimestamp: true,
    },
    services: [
      {
        id: report.businessServiceId,
        name: report.name,
        uptime: report.weightedUptimePercent,
        slaTarget: target,
        downtimeMinutes: report.weightedDowntimeMinutes,
      },
    ],
    incidents: report.incidents.map(incident => ({
      id: incident.id,
      title: incident.title,
      startedAt: incident.impactStartedAt,
      resolvedAt: incident.impactEndedAt,
      durationMinutes: incident.impactMinutes,
      status: incident.impactEndedAt ? 'RESOLVED' : 'ONGOING',
    })),
    overallAvailability: report.weightedUptimePercent,
    slaComplianceRate: report.sloMet === false ? 0 : 100,
  });
}
