import 'server-only';

import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BellRing, ClipboardCheck, Repeat2, Server } from 'lucide-react';
import { EmptyState } from '@/components/patterns';
import {
  getAnalyticsSection,
  METRICS,
  type AnalyticsContext,
  type AnalyticsSectionData,
  type AnalyticsSectionKey,
  type MetricId,
} from '@/lib/analytics';
import type { DrillKind } from '@/lib/analytics/drilldown';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import ChartFrame from './ChartFrame';
import DeltaBadge from './DeltaBadge';
import IncidentDrillSheet from './IncidentDrillSheet';
import { describeDelta, formatBucket, formatDuration, formatMetric } from './format';
import { DurationChart, InterruptionsChart, VolumeChart } from './LazyTrendCharts';
import MetricInfo from './MetricInfo';
import { SectionCard } from './SectionCard';
import SectionError from './SectionError';
import ServicesTable from './ServicesTable';
import MetricChangeWhy from './MetricChangeWhy';
import {
  loadMetricChanges,
  METRIC_CHANGE_MAX_WINDOW_DAYS,
  type MetricChanges,
} from '@/lib/intelligence/helpers/metric-change-loader';
import type { ChangeMetric } from '@/lib/intelligence/helpers/metric-change';

/** Loads one section; a failure renders an inline retry instead of breaking the page. */
export async function load<K extends AnalyticsSectionKey>(
  context: AnalyticsContext,
  section: K
): Promise<{ data: AnalyticsSectionData<K> } | { error: string }> {
  try {
    return { data: await getAnalyticsSection(context, section) };
  } catch (error) {
    const reference = randomUUID().slice(0, 8);
    logger.error('analytics.section_failed', { section, reference, error });
    return { error: reference };
  }
}

export function NoIncidents({ filtered }: { filtered: boolean }) {
  return (
    <EmptyState
      variant="simple"
      size="sm"
      title="No incidents in this period"
      description={
        filtered
          ? 'Nothing matches these filters. Widen the time range or clear filters.'
          : 'Incidents created in the selected period will show up here.'
      }
    />
  );
}

export const isFiltered = (context: AnalyticsContext) => {
  const p = context.params;
  return Boolean(
    p.teams.length ||
    p.services.length ||
    p.priorities.length ||
    p.urgency ||
    p.status ||
    p.assignee
  );
};

// ------------------------------------------------------------------ KPIs

const KPI_TILES: Array<{
  id: MetricId;
  secondary?: MetricId;
  href?: string;
  drill?: { kind: DrillKind; title: string };
}> = [
  { id: 'incidents', drill: { kind: 'all', title: 'Incidents in this period' } },
  { id: 'openNow', href: '/incidents?filter=all_open' },
  { id: 'mttaP50', secondary: 'mttaP90' },
  { id: 'mttrP50', secondary: 'mttrP90' },
  { id: 'ackSla', drill: { kind: 'ackBreached', title: 'Incidents that breached the ack SLA' } },
  {
    id: 'resolveSla',
    drill: { kind: 'resolveBreached', title: 'Incidents that breached the resolve SLA' },
  },
  { id: 'escalationRate', drill: { kind: 'escalated', title: 'Escalated incidents' } },
  { id: 'afterHoursRate', drill: { kind: 'afterHours', title: 'Incidents created after hours' } },
];

const CHANGE_METRIC_FOR: Partial<Record<MetricId, ChangeMetric>> = {
  incidents: 'incidents',
  mttaP50: 'mtta',
  mttrP50: 'mttr',
};

/**
 * "Why did this change" comes from per-service daily rollups, which only answer a preset range of at
 * most 90 days on the unfiltered or single-team view. A helper, never a gate: failures show nothing.
 */
function kpiChanges(context: AnalyticsContext): {
  windowDays: number;
  teamId?: string;
  changes: Promise<MetricChanges>;
} | null {
  const p = context.params;
  const windowDays = parseInt(p.range, 10);
  if (
    !p.compare ||
    p.range === 'custom' ||
    p.range === '24h' ||
    !(windowDays <= METRIC_CHANGE_MAX_WINDOW_DAYS) ||
    p.teams.length > 1 ||
    p.services.length ||
    p.priorities.length ||
    p.urgency ||
    p.status ||
    p.assignee
  )
    return null;
  const teamId = p.teams[0];
  return {
    windowDays,
    teamId,
    changes: loadMetricChanges(context.scope.actor, { windowDays, teamId }).catch(() => ({})),
  };
}

export async function KpiSection({ context }: { context: AnalyticsContext }) {
  const why = kpiChanges(context);
  const result = await load(context, 'kpis');
  if ('error' in result) {
    return (
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <SectionError title="Key metrics" errorCode={result.error} />
      </div>
    );
  }
  const { current, previous, openNow } = result.data;
  const values: Partial<Record<MetricId, number | null>> = {
    incidents: current.incidents,
    openNow,
    mttaP50: current.mttaP50,
    mttaP90: current.mttaP90,
    mttrP50: current.mttrP50,
    mttrP90: current.mttrP90,
    ackSla: current.ackSla,
    resolveSla: current.resolveSla,
    escalationRate: current.escalationRate,
    afterHoursRate: current.afterHoursRate,
  };
  const previousValues: Partial<Record<MetricId, number | null>> = {
    incidents: previous.incidents,
    mttaP50: previous.mttaP50,
    mttrP50: previous.mttrP50,
    ackSla: previous.ackSla,
    resolveSla: previous.resolveSla,
    escalationRate: previous.escalationRate,
    afterHoursRate: previous.afterHoursRate,
  };
  const changes = why ? await why.changes : {};
  // Shown only when the rollups agree with the tile's own direction, so the line never contradicts it.
  const whyFooter = (tile: { id: MetricId }) => {
    const metric = CHANGE_METRIC_FOR[tile.id];
    const change = metric === undefined ? undefined : changes[metric as ChangeMetric];
    const now = values[tile.id];
    const before = previousValues[tile.id];
    if (!why || !metric || !change || now == null || before == null || now === before) return null;
    if (now > before !== (change.direction === 'up')) return null;
    return (
      <div className="relative z-10">
        <MetricChangeWhy
          metric={metric}
          line={change.line}
          windowDays={why.windowDays}
          teamId={why.teamId}
        />
      </div>
    );
  };

  return (
    <section aria-labelledby="analytics-kpis">
      <h2 id="analytics-kpis" className="sr-only">
        Key metrics
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {KPI_TILES.map(tile => {
          const definition = METRICS[tile.id];
          const value = values[tile.id] ?? null;
          const delta =
            context.params.compare && tile.id in previousValues
              ? describeDelta(
                  value,
                  previousValues[tile.id] ?? null,
                  definition.unit,
                  definition.better
                )
              : null;
          const body = (
            <>
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <span className="truncate">{definition.label}</span>
                {/* Above the drill overlay so the info popover stays clickable. */}
                <span className="relative z-10 inline-flex">
                  <MetricInfo metrics={tile.secondary ? [tile.id, tile.secondary] : [tile.id]} />
                </span>
              </div>
              <p
                className={cn(
                  'mt-1 font-display text-2xl font-semibold tabular-nums sm:text-3xl',
                  value === null && 'text-muted-foreground',
                  tile.drill && 'decoration-dotted underline-offset-4 group-hover:underline'
                )}
              >
                {formatMetric(value, definition.unit)}
              </p>
              <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <DeltaBadge delta={delta} />
                {tile.secondary && values[tile.secondary] != null && (
                  <span className="tabular-nums">
                    p90 {formatMetric(values[tile.secondary] ?? null, METRICS[tile.secondary].unit)}
                  </span>
                )}
                {value === null && <span>No data</span>}
              </div>
            </>
          );
          return (
            <li
              key={tile.id}
              className={cn(
                'min-w-0 rounded-lg border bg-card p-3 shadow-sm sm:p-4',
                tile.drill && 'group relative'
              )}
            >
              {tile.drill && (
                <IncidentDrillSheet
                  drill={tile.drill.kind}
                  title={tile.drill.title}
                  label={`${definition.label}: show ${tile.drill.title.charAt(0).toLowerCase()}${tile.drill.title.slice(1)}`}
                  className="absolute inset-0 rounded-lg"
                />
              )}
              {tile.href ? (
                <Link
                  href={tile.href}
                  className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {body}
                </Link>
              ) : (
                body
              )}
              {whyFooter(tile)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ Trends

function TrendTable({
  rows,
  bucket,
  columns,
}: {
  rows: AnalyticsSectionData<'trend'>;
  bucket: AnalyticsContext['window']['bucket'];
  columns: Array<{ label: string; render: (row: AnalyticsSectionData<'trend'>[number]) => string }>;
}) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-card">
        <tr className="border-b text-muted-foreground">
          <th scope="col" className="py-1.5 text-left font-medium">
            {bucket === 'hour'
              ? 'Hour'
              : bucket === 'week'
                ? 'Week of'
                : bucket === 'month'
                  ? 'Month'
                  : 'Day'}
          </th>
          {columns.map(column => (
            <th key={column.label} scope="col" className="py-1.5 text-right font-medium">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.bucket} className="border-b last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal">
              {formatBucket(row.bucket, bucket === 'month' ? 'month' : 'day')}
              {bucket === 'hour' ? ` ${formatBucket(row.bucket, 'hour')}` : ''}
            </th>
            {columns.map(column => (
              <td key={column.label} className="py-1.5 text-right tabular-nums">
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export async function TrendSection({ context }: { context: AnalyticsContext }) {
  const result = await load(context, 'trend');
  const { bucket } = context.window;
  const unitLabel = bucket;
  if ('error' in result) {
    return (
      <SectionCard id="analytics-volume" title="Incident volume" className="xl:col-span-12">
        <SectionError title="Incident volume" errorCode={result.error} />
      </SectionCard>
    );
  }
  const rows = result.data;
  const total = rows.reduce((sum, row) => sum + row.high + row.medium + row.low, 0);
  const compare = context.params.compare;
  const durationColumns = (prefix: 'mtta' | 'mttr') => [
    {
      label: 'Median',
      render: (row: (typeof rows)[number]) => formatDuration(row[`${prefix}P50`]),
    },
    { label: 'p90', render: (row: (typeof rows)[number]) => formatDuration(row[`${prefix}P90`]) },
    ...(compare
      ? [
          {
            label: 'Previous median',
            render: (row: (typeof rows)[number]) =>
              formatDuration(prefix === 'mtta' ? row.previousMttaP50 : row.previousMttrP50),
          },
        ]
      : []),
  ];

  return (
    <>
      <SectionCard
        id="analytics-volume"
        title="Incident volume"
        description={`Incidents created per ${unitLabel}, by urgency`}
        info={<MetricInfo metrics={['incidents']} />}
        className="xl:col-span-12"
      >
        {total === 0 ? (
          <NoIncidents filtered={isFiltered(context)} />
        ) : (
          <ChartFrame
            label="Incident volume"
            chart={<VolumeChart data={rows} bucket={bucket} />}
            table={
              <TrendTable
                rows={rows}
                bucket={bucket}
                columns={[
                  { label: 'High', render: row => String(row.high) },
                  { label: 'Medium', render: row => String(row.medium) },
                  { label: 'Low', render: row => String(row.low) },
                  { label: 'Total', render: row => String(row.high + row.medium + row.low) },
                  ...(compare
                    ? [
                        {
                          label: 'Previous',
                          render: (row: (typeof rows)[number]) =>
                            formatMetric(row.previousTotal, 'count'),
                        },
                      ]
                    : []),
                ]}
              />
            }
          />
        )}
      </SectionCard>
      {(['mtta', 'mttr'] as const).map(metric => (
        <SectionCard
          key={metric}
          id={`analytics-${metric}`}
          title={metric === 'mtta' ? 'Time to acknowledge' : 'Time to resolve'}
          description={`Median and p90 per ${unitLabel}`}
          info={
            <MetricInfo
              metrics={metric === 'mtta' ? ['mttaP50', 'mttaP90'] : ['mttrP50', 'mttrP90']}
            />
          }
          className="xl:col-span-6"
        >
          {total === 0 ? (
            <NoIncidents filtered={isFiltered(context)} />
          ) : (
            <ChartFrame
              label={metric === 'mtta' ? 'Time to acknowledge' : 'Time to resolve'}
              chart={<DurationChart data={rows} bucket={bucket} metric={metric} />}
              table={<TrendTable rows={rows} bucket={bucket} columns={durationColumns(metric)} />}
            />
          )}
        </SectionCard>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Services

export async function ServicesSection({ context }: { context: AnalyticsContext }) {
  const result = await load(context, 'services');
  return (
    <SectionCard
      id="analytics-services"
      title="Services"
      description="Reliability per service. Select a service to filter the whole page."
      info={
        <MetricInfo metrics={['mttaP50', 'mttrP50', 'ackSla', 'resolveSla', 'alertsPerIncident']} />
      }
      className="xl:col-span-12"
    >
      {'error' in result ? (
        <SectionError title="Services" errorCode={result.error} />
      ) : result.data.length === 0 ? (
        <NoIncidents filtered={isFiltered(context)} />
      ) : (
        <ServicesTable rows={result.data} compare={context.params.compare} />
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------ Responders

const BANDS = [
  { key: 'working', label: 'Business hours', color: 'var(--chart-ordinal-1)' },
  { key: 'evening', label: 'Evenings & weekends', color: 'var(--chart-ordinal-2)' },
  { key: 'overnight', label: 'Overnight (22:00–08:00)', color: 'var(--chart-ordinal-3)' },
] as const;

export async function RespondersSection({ context }: { context: AnalyticsContext }) {
  const [result, interruptions] = await Promise.all([
    load(context, 'responders'),
    load(context, 'interruptions'),
  ]);
  return (
    <SectionCard
      id="analytics-responders"
      title="Responder load"
      description="Assigned incidents by time of day in each responder's own timezone, time spent handling them, plus scheduled on-call time"
      info={
        <MetricInfo
          metrics={['afterHoursRate', 'handlingHours', 'offHoursInterruptions', 'onCallHours']}
        />
      }
      className="xl:col-span-7"
    >
      {'error' in result ? (
        <SectionError title="Responder load" errorCode={result.error} />
      ) : result.data.length === 0 ? (
        <EmptyState
          variant="simple"
          size="sm"
          title="No assigned incidents or on-call time"
          description="Responders appear here once incidents are assigned or schedules have shifts in this period."
        />
      ) : (
        <>
          <ResponderList
            rows={result.data}
            trends={'error' in interruptions ? {} : interruptions.data.byResponder}
          />
          <OffHoursTrend result={interruptions} bucket={context.window.bucket} />
        </>
      )}
    </SectionCard>
  );
}

const HOUR_MS = 3_600_000;

/** Tiny off-hours trend per responder; decorative, the counts sit next to it as text. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const step = 48 / Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => `${index * step},${15 - (value / max) * 14}`)
    .join(' ');
  return (
    <svg viewBox="0 0 48 16" className="h-4 w-12 shrink-0 text-muted-foreground" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResponderList({
  rows,
  trends,
}: {
  rows: AnalyticsSectionData<'responders'>;
  trends: Record<string, number[]>;
}) {
  const max = Math.max(1, ...rows.map(row => row.incidents));
  const offHours = (row: (typeof rows)[number]) =>
    row.handlingEveningHours + row.handlingOvernightHours;
  const totalHandling = rows.reduce((sum, row) => sum + row.handlingHours, 0);
  const totalOffHours = rows.reduce((sum, row) => sum + offHours(row), 0);
  return (
    <div>
      {totalHandling > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          Hours handling across listed responders:{' '}
          <span className="font-medium tabular-nums text-foreground">
            {formatDuration(totalHandling * HOUR_MS)}
          </span>
          , <span className="tabular-nums">{formatDuration(totalOffHours * HOUR_MS)}</span> of it
          off-hours (
          <span className="tabular-nums">{Math.round((totalOffHours / totalHandling) * 100)}%</span>
          )
        </p>
      )}
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        {BANDS.map(band => (
          <li key={band.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: band.color }} />
            {band.label}
          </li>
        ))}
      </ul>
      <ul className="space-y-3">
        {rows.slice(0, 10).map(row => {
          const trend = trends[row.id];
          return (
            <li
              key={row.id}
              className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,9rem)_1fr_auto]"
            >
              <span className="truncate font-medium" title={row.name}>
                {row.name}
              </span>
              <div
                className="flex h-2.5 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${row.name}: ${row.working} in business hours, ${row.evening} evenings and weekends, ${row.overnight} overnight`}
                style={{ width: `${Math.max(4, (row.incidents / max) * 100)}%` }}
              >
                {BANDS.map(band =>
                  row[band.key] > 0 ? (
                    <span
                      key={band.key}
                      className="h-full border-r-2 border-card last:border-r-0"
                      style={{
                        width: `${(row[band.key] / row.incidents) * 100}%`,
                        background: band.color,
                      }}
                    />
                  ) : null
                )}
              </div>
              <span className="col-span-2 flex items-center justify-end gap-2 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground sm:col-span-1">
                {trend && trend.length > 1 && trend.some(Boolean) && <Sparkline values={trend} />}
                <span>
                  <span className="font-medium text-foreground">{row.incidents}</span> inc
                  {row.handlingHours > 0 && (
                    <>
                      {' · '}
                      <span title={`${formatDuration(offHours(row) * HOUR_MS)} off-hours`}>
                        {formatDuration(row.handlingHours * HOUR_MS)} handling
                      </span>
                    </>
                  )}
                  {row.onCallHours > 0 && <> · {formatMetric(row.onCallHours, 'hours')} on call</>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OffHoursTrend({
  result,
  bucket,
}: {
  result: Awaited<ReturnType<typeof load<'interruptions'>>>;
  bucket: AnalyticsContext['window']['bucket'];
}) {
  return (
    <div className="mt-5 border-t pt-4">
      <h3 className="text-sm font-semibold">Off-hours interruptions</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Incidents landing in each responder&apos;s evenings, weekends or nights, per {bucket}
      </p>
      {'error' in result ? (
        <SectionError title="Off-hours interruptions" errorCode={result.error} />
      ) : !result.data.points.some(point => point.evening + point.overnight > 0) ? (
        <p className="text-xs text-muted-foreground">No off-hours interruptions in this period.</p>
      ) : (
        <ChartFrame
          label="Off-hours interruptions"
          chart={<InterruptionsChart data={result.data.points} bucket={bucket} />}
          table={
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-1.5 text-left font-medium">
                    {bucket === 'hour'
                      ? 'Hour'
                      : bucket === 'week'
                        ? 'Week of'
                        : bucket === 'month'
                          ? 'Month'
                          : 'Day'}
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Evenings & weekends
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Overnight
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.data.points.map(point => (
                  <tr key={point.bucket} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {formatBucket(point.bucket, bucket === 'month' ? 'month' : 'day')}
                      {bucket === 'hour' ? ` ${formatBucket(point.bucket, 'hour')}` : ''}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{point.evening}</td>
                    <td className="py-1.5 text-right tabular-nums">{point.overnight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Timing

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SEQ = [
  '--chart-seq-0',
  '--chart-seq-1',
  '--chart-seq-2',
  '--chart-seq-3',
  '--chart-seq-4',
  '--chart-seq-5',
];

export async function TimingSection({ context }: { context: AnalyticsContext }) {
  const result = await load(context, 'timing');
  return (
    <SectionCard
      id="analytics-timing"
      title="When incidents happen"
      description={`Day and hour, in your timezone (${context.window.timeZone})`}
      className="xl:col-span-5"
    >
      {'error' in result ? (
        <SectionError title="When incidents happen" errorCode={result.error} />
      ) : result.data.max === 0 ? (
        <NoIncidents filtered={isFiltered(context)} />
      ) : (
        <Heatmap counts={result.data.counts} max={result.data.max} />
      )}
    </SectionCard>
  );
}

function Heatmap({ counts, max }: { counts: number[][]; max: number }) {
  const step = (value: number) =>
    value === 0
      ? SEQ[0]
      : SEQ[Math.min(SEQ.length - 1, Math.ceil((value / max) * (SEQ.length - 1)))];
  const busiest = counts
    .flatMap((hours, day) => hours.map((count, hour) => ({ day, hour, count })))
    .filter(cell => cell.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return (
    <div>
      <div
        role="img"
        aria-label={`Incident heatmap by weekday and hour. Busiest: ${busiest
          .map(cell => `${DAYS[cell.day]} ${String(cell.hour).padStart(2, '0')}:00 (${cell.count})`)
          .join(', ')}`}
        className="grid gap-0.5"
        style={{ gridTemplateColumns: '2rem repeat(24, minmax(0, 1fr))' }}
      >
        {counts.map((hours, day) => (
          <div key={DAYS.at(day)} className="contents">
            <span className="pr-1 text-2xs leading-4 text-muted-foreground" aria-hidden>
              {DAYS.at(day)}
            </span>
            {hours.map((count, hour) => (
              <span
                key={hour}
                title={`${DAYS.at(day)} ${String(hour).padStart(2, '0')}:00 — ${count} incident${count === 1 ? '' : 's'}`}
                className="aspect-square min-h-2 rounded-sm"
                style={{ background: `var(${step(count)})` }}
              />
            ))}
          </div>
        ))}
        <span aria-hidden />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} aria-hidden className="text-center text-2xs text-muted-foreground">
            {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          Busiest:{' '}
          {busiest.map((cell, index) => (
            <span key={`${cell.day}-${cell.hour}`} className="tabular-nums">
              {index > 0 && ', '}
              <span className="font-medium text-foreground">
                {DAYS[cell.day]} {String(cell.hour).padStart(2, '0')}:00
              </span>{' '}
              ({cell.count})
            </span>
          ))}
        </p>
        <span className="flex items-center gap-1" aria-hidden>
          Fewer
          {SEQ.map(token => (
            <span
              key={token}
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: `var(${token})` }}
            />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Noise

function Stat({
  label,
  value,
  metrics,
}: {
  label: string;
  value: ReactNode;
  metrics?: MetricId[];
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {metrics && <MetricInfo metrics={metrics} />}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export async function NoiseSection({ context }: { context: AnalyticsContext }) {
  const result = await load(context, 'noise');
  return (
    <SectionCard
      id="analytics-noise"
      title="Noise"
      description="Where alerts and repeat incidents come from"
      className="xl:col-span-7"
    >
      {'error' in result ? (
        <SectionError title="Noise" errorCode={result.error} />
      ) : result.data.incidents === 0 ? (
        <NoIncidents filtered={isFiltered(context)} />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Alerts" value={formatMetric(result.data.alerts, 'count')} />
            <Stat
              label="Per incident"
              value={formatMetric(result.data.alertsPerIncident, 'ratio')}
              metrics={['alertsPerIncident']}
            />
            <Stat
              label="Auto-resolved"
              value={formatMetric(result.data.autoResolvedRate, 'percent')}
              metrics={['autoResolvedRate']}
            />
          </dl>
          <div className="grid gap-5 md:grid-cols-2">
            <RankedList
              icon={<Server className="h-3.5 w-3.5" aria-hidden />}
              title="Loudest services"
              empty="No alerts were grouped into incidents."
              items={result.data.noisyServices.map(service => ({
                key: service.id,
                label: service.name,
                value: service.alerts,
                detail: `${service.alerts} alerts · ${service.incidents} inc`,
              }))}
            />
            <RankedList
              icon={<Repeat2 className="h-3.5 w-3.5" aria-hidden />}
              title="Recurring incidents"
              empty="No incident title repeated in this period."
              items={result.data.recurringTitles.map(title => ({
                key: title.title,
                label: title.title,
                value: title.count,
                detail: `${title.count}×`,
              }))}
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function RankedList({
  icon,
  title,
  empty,
  items,
}: {
  icon: ReactNode;
  title: string;
  empty: string;
  items: Array<{ key: string; label: string; value: number; detail: string }>;
}) {
  const max = Math.max(1, ...items.map(item => item.value));
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="space-y-2">
          {items.map(item => (
            <li key={item.key} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.detail}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(item.value / max) * 100}%`,
                    background: 'var(--chart-series-1)',
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Follow-through

export async function FollowThroughSection({ context }: { context: AnalyticsContext }) {
  const result = await load(context, 'followThrough');
  return (
    <SectionCard
      id="analytics-follow-through"
      title="Follow-through"
      description="Learning from high-urgency incidents"
      className="xl:col-span-5"
    >
      {'error' in result ? (
        <SectionError title="Follow-through" errorCode={result.error} />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3">
            <Stat
              label="Postmortems"
              value={
                <>
                  {formatMetric(result.data.postmortemRate, 'percent')}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {result.data.postmortemsPublished} of {result.data.highResolved}
                  </span>
                </>
              }
              metrics={['postmortemRate']}
            />
            <Stat label="Drafts" value={formatMetric(result.data.postmortemsDraft, 'count')} />
            <Stat
              label="Open actions"
              value={formatMetric(result.data.actionItemsOpen, 'count')}
              metrics={['actionItemsOpen']}
            />
            <Stat
              label="Overdue"
              value={
                <span className={cn(result.data.actionItemsOverdue > 0 && 'text-destructive')}>
                  {formatMetric(result.data.actionItemsOverdue, 'count')}
                </span>
              }
              metrics={['actionItemsOverdue']}
            />
          </dl>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link
              href="/postmortems"
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden /> Postmortems
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <Link
              href="/action-items"
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              <BellRing className="h-4 w-4" aria-hidden /> Action items
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
