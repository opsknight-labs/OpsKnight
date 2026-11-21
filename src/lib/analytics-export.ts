import type {
  AnalyticsParams,
  AnalyticsWindow,
  AvailabilityRow,
  BreakdownRow,
  FollowThroughSection,
  KpiSection,
  MetricId,
  NoiseSection,
  ResponderRow,
  ServiceRow,
  TrendPoint,
} from '@/lib/analytics';
import { METRICS } from '@/lib/analytics/definitions';
import { toAnalyticsSearchParams } from '@/lib/analytics/params';
import { formatDateTime } from '@/lib/timezone';

/**
 * Pure CSV rendering for the analytics export. The route fetches the same
 * sections the page renders (getAnalyticsSection) and hands them here, so
 * totals in the file always equal the page.
 */

type Cell = string | number | null | undefined;

export type AnalyticsExportIncident = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  priority: string | null;
  service: string | null;
  assignee: string | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
};

export type AnalyticsExportData = {
  params: AnalyticsParams;
  window: AnalyticsWindow;
  generatedAt: Date;
  kpis: KpiSection;
  services: ServiceRow[];
  trend: TrendPoint[];
  responders: ResponderRow[];
  noise: NoiseSection;
  followThrough: FollowThroughSection;
  /** Optional: same rows as the page's Breakdown tabs. */
  breakdowns?: Array<{ title: string; rows: BreakdownRow[] }>;
  /** Optional: same rows as the page's Availability section. */
  availability?: AvailabilityRow[];
  incidents: AnalyticsExportIncident[];
  /** Max incident rows written; the file says so when it is reached. */
  incidentLimit: number;
};

/** Quote for CSV and neutralise spreadsheet formulas (CWE-1236). Numbers are written as-is. */
export function escapeCsvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let str = value;
  if (/^[=+\-@\t\r|%]/.test(str.trimStart())) str = `'${str}`;
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const UNIT_SUFFIX = { count: '', duration: ' (min)', percent: ' (%)', ratio: '', hours: ' (h)' };

/** Column header for a metric, from the registry. */
export const metricHeader = (id: MetricId) =>
  // eslint-disable-next-line security/detect-object-injection -- id is a typed MetricId and unit a closed union, not user input
  `${METRICS[id].label}${UNIT_SUFFIX[METRICS[id].unit]}`;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Spreadsheet-friendly value: durations in minutes, percents 0-100; null stays empty. */
export function metricValue(id: MetricId, value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
  switch (METRICS[id].unit) {
    case 'duration':
      return round(value / 60_000, 1);
    case 'percent':
    case 'hours':
      return round(value, 1);
    case 'ratio':
      return round(value, 2);
    default:
      return value;
  }
}

const AGGREGATE_IDS = [
  'mttaP50',
  'mttaP90',
  'mttrP50',
  'mttrP90',
  'ackSla',
  'resolveSla',
  'escalationRate',
  'afterHoursRate',
] as const satisfies readonly MetricId[];

export function buildAnalyticsCsv(data: AnalyticsExportData): string {
  const { window, kpis } = data;
  const tz = window.timeZone;
  const at = (date: Date | null) => (date ? formatDateTime(date, tz, { format: 'datetime' }) : '');
  const rows: Cell[][] = [];
  const section = (title: string, header: Cell[]) => rows.push([], [title], header);

  rows.push(['OpsKnight Analytics Export']);
  rows.push(['Generated', at(data.generatedAt)]);
  rows.push(['Period start', at(window.start)]);
  rows.push(['Period end', at(window.end)]);
  rows.push(['Timezone', tz]);
  rows.push(['Business-hours timezone', window.businessTimeZone]);
  if (window.isClipped) rows.push(['Note', 'Period shortened by the data retention policy.']);
  const filters = [...toAnalyticsSearchParams(data.params)].map(
    ([key, value]) => `${key}=${value}`
  );
  rows.push(['Filters', filters.join('; ') || 'None']);

  section('Summary', ['Metric', 'Current', 'Previous period', 'Definition']);
  const kpi = (id: MetricId, current: number | null, previous: number | null) =>
    rows.push([
      metricHeader(id),
      metricValue(id, current),
      metricValue(id, previous),
      // eslint-disable-next-line security/detect-object-injection -- id is a typed MetricId, not user input
      METRICS[id].description,
    ]);
  kpi('incidents', kpis.current.incidents, kpis.previous.incidents);
  kpi('openNow', kpis.openNow, null);
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
  for (const id of AGGREGATE_IDS) kpi(id, kpis.current[id], kpis.previous[id]);

  section('Services', [
    'Service',
    metricHeader('incidents'),
    'Previous period incidents',
    'Alerts',
    ...AGGREGATE_IDS.map(metricHeader),
  ]);
  for (const s of data.services) {
    rows.push([
      s.name,
      s.incidents,
      s.previousIncidents,
      s.alerts,
      // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
      ...AGGREGATE_IDS.map(id => metricValue(id, s[id])),
    ]);
  }

  for (const breakdown of data.breakdowns ?? []) {
    section(`Breakdown by ${breakdown.title}`, [
      breakdown.title.charAt(0).toUpperCase() + breakdown.title.slice(1),
      metricHeader('incidents'),
      'Previous period incidents',
      metricHeader('mttaP50'),
      metricHeader('mttrP50'),
      metricHeader('mttrP90'),
      metricHeader('ackSla'),
      metricHeader('resolveSla'),
    ]);
    for (const row of breakdown.rows) {
      rows.push([
        row.label,
        row.incidents,
        row.previousIncidents,
        metricValue('mttaP50', row.mttaP50),
        metricValue('mttrP50', row.mttrP50),
        metricValue('mttrP90', row.mttrP90),
        metricValue('ackSla', row.ackSla),
        metricValue('resolveSla', row.resolveSla),
      ]);
    }
  }

  if (data.availability?.length) {
    section('Availability', [
      'Service',
      'Uptime (%)',
      'Downtime (min)',
      'Objective',
      'Objective target (%)',
      'Error budget left (%)',
    ]);
    for (const a of data.availability) {
      rows.push([
        a.name,
        round(a.uptime, 3),
        round(a.downtimeMs / 60_000, 1),
        a.objective?.name ?? '',
        a.objective ? round(a.objective.target, 3) : null,
        a.budgetRemaining === null ? null : round(a.budgetRemaining, 1),
      ]);
    }
  }

  section('Trend', [
    `Bucket (${window.bucket}, ${tz})`,
    'High',
    'Medium',
    'Low',
    metricHeader('incidents'),
    metricHeader('mttaP50'),
    metricHeader('mttaP90'),
    metricHeader('mttrP50'),
    metricHeader('mttrP90'),
  ]);
  for (const p of data.trend) {
    rows.push([
      p.bucket,
      p.high,
      p.medium,
      p.low,
      p.high + p.medium + p.low,
      metricValue('mttaP50', p.mttaP50),
      metricValue('mttaP90', p.mttaP90),
      metricValue('mttrP50', p.mttrP50),
      metricValue('mttrP90', p.mttrP90),
    ]);
  }

  section('Responders (bands in each responder’s timezone)', [
    'Responder',
    metricHeader('incidents'),
    'Working hours',
    'Evening / weekend',
    'Overnight',
    metricHeader('onCallHours'),
    metricHeader('handlingHours'),
    'Handling off-hours (h)',
  ]);
  for (const r of data.responders) {
    rows.push([
      r.name,
      r.incidents,
      r.working,
      r.evening,
      r.overnight,
      metricValue('onCallHours', r.onCallHours),
      metricValue('handlingHours', r.handlingHours),
      metricValue('handlingHours', r.handlingEveningHours + r.handlingOvernightHours),
    ]);
  }

  const { noise, followThrough: ft } = data;
  section('Noise', ['Metric', 'Value']);
  rows.push(['Alerts', noise.alerts]);
  rows.push([
    metricHeader('alertsPerIncident'),
    metricValue('alertsPerIncident', noise.alertsPerIncident),
  ]);
  rows.push(['Resolved incidents', noise.resolved]);
  rows.push(['Auto-resolved incidents', noise.autoResolved]);
  rows.push([
    metricHeader('autoResolvedRate'),
    metricValue('autoResolvedRate', noise.autoResolvedRate),
  ]);
  section('Noisiest services', ['Service', 'Alerts', metricHeader('incidents')]);
  for (const s of noise.noisyServices) rows.push([s.name, s.alerts, s.incidents]);
  section('Recurring incident titles', ['Title', metricHeader('incidents'), 'Last seen']);
  for (const t of noise.recurringTitles) rows.push([t.title, t.count, at(new Date(t.lastSeen))]);

  section('Follow-through', ['Metric', 'Value']);
  rows.push(['Resolved high-urgency incidents', ft.highResolved]);
  rows.push(['Postmortems published', ft.postmortemsPublished]);
  rows.push(['Postmortems in draft', ft.postmortemsDraft]);
  rows.push([metricHeader('postmortemRate'), metricValue('postmortemRate', ft.postmortemRate)]);
  rows.push([metricHeader('actionItemsOpen'), ft.actionItemsOpen]);
  rows.push([metricHeader('actionItemsOverdue'), ft.actionItemsOverdue]);
  rows.push(['Completed action items', ft.actionItemsCompleted]);

  const truncated = data.incidents.length > data.incidentLimit;
  section(
    truncated
      ? `Incidents (newest ${data.incidentLimit} of ${kpis.current.incidents}; narrow the filters for the rest)`
      : 'Incidents',
    [
      'ID',
      'Title',
      'Service',
      'Status',
      'Urgency',
      'Priority',
      'Assignee',
      'Created',
      'Acknowledged',
      'Resolved',
    ]
  );
  for (const i of data.incidents.slice(0, data.incidentLimit)) {
    rows.push([
      i.id,
      i.title,
      i.service ?? 'Unknown',
      i.status,
      i.urgency,
      i.priority,
      i.assignee ?? 'Unassigned',
      at(i.createdAt),
      at(i.acknowledgedAt),
      at(i.resolvedAt),
    ]);
  }

  return '﻿' + rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}
