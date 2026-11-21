import type { ReactNode } from 'react';
import Link from 'next/link';
import DeltaBadge from '@/components/analytics/DeltaBadge';
import MetricInfo from '@/components/analytics/MetricInfo';
import { describeDelta } from '@/components/analytics/format';
import type { OverviewNoise } from '@/lib/intelligence/overview/noise';
import type { OverviewOutcomes } from '@/lib/intelligence/overview/outcomes';
import type { SectionResult } from '@/lib/intelligence/overview/scope';
import type { AcceptanceRate, OverviewSpeed } from '@/lib/intelligence/overview/speed';
import { formatCount, formatDuration, formatPercent } from '@/lib/intelligence/overview/window';
import { cn } from '@/lib/utils';
import { NO_VALUE } from './primitives';

interface Kpi {
  label: string;
  /** One sentence for the info tooltip. */
  info: string;
  value: string;
  secondary: ReactNode;
  delta?: ReturnType<typeof describeDelta>;
}

const GRID = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4';
const UNAVAILABLE = { value: NO_VALUE, secondary: 'Unavailable' };

function reviewed(rate: AcceptanceRate, noun: string) {
  return rate.reviewed === 0
    ? { value: NO_VALUE, secondary: `None ${noun} yet` }
    : {
        value: formatPercent(rate.rate),
        secondary: `${formatCount(rate.accepted)} of ${formatCount(rate.reviewed)} ${noun}`,
      };
}

function responseTime(
  outcomes: SectionResult<OverviewOutcomes>,
  key: 'mttaSeconds' | 'mttrSeconds'
): Pick<Kpi, 'value' | 'secondary' | 'delta'> {
  if (!outcomes.ok) return UNAVAILABLE;
  const { current, previous } = outcomes.data;
  const count = key === 'mttaSeconds' ? current.acknowledged : current.resolved;
  const verb = key === 'mttaSeconds' ? 'acknowledged' : 'resolved';
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, not user input
  const now = current[key];
  return {
    value: formatDuration(now),
    // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, not user input
    delta: describeDelta(now, previous[key], 'duration', 'down'),
    secondary: now === null ? `No incidents ${verb} yet` : `${formatCount(count)} ${verb}`,
  };
}

/**
 * The overview's headline numbers as separate cards, in the Analytics KPI style. Each loader that fails
 * only blanks its own cards ("—", "Unavailable"); only response times have a previous window to compare.
 */
export default function OverviewKpis({
  noise,
  speed,
  outcomes,
  triageEnabled,
  canManage,
}: {
  noise: SectionResult<OverviewNoise>;
  speed: SectionResult<OverviewSpeed>;
  outcomes: SectionResult<OverviewOutcomes>;
  triageEnabled: boolean;
  canManage: boolean;
}) {
  const n = noise.ok ? noise.data : null;
  const s = speed.ok ? speed.data : null;
  const triageOff = (
    <>
      Triage suggestions are off.
      {canManage && (
        <Link
          href="/settings/intelligence#triage"
          className="inline-flex min-h-11 items-center rounded-sm px-1 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
        >
          Turn on
        </Link>
      )}
    </>
  );

  const kpis: Kpi[] = [
    {
      label: 'Alerts received',
      info: 'Alerts that reached OpsKnight for the services in scope during this window.',
      ...(n
        ? {
            value: formatCount(n.alerts),
            secondary: `${formatCount(n.incidents)} incidents created`,
          }
        : UNAVAILABLE),
    },
    {
      label: 'Compression',
      info: 'Alerts received per incident created; higher means more alerts were grouped into one incident.',
      ...(n
        ? {
            value: `${n.compressionRatio.toLocaleString('en-US', { maximumFractionDigits: 1 })}×`,
            secondary: 'Alerts per incident',
          }
        : UNAVAILABLE),
    },
    {
      label: 'Pages avoided',
      info: 'Pages that noise controls held back while switched on; shadow decisions are never counted here.',
      ...(n
        ? {
            value: formatCount(n.pagesAvoided),
            secondary:
              n.downgraded > 0
                ? `Applied by noise controls · ${formatCount(n.downgraded)} downgraded`
                : 'Applied by noise controls',
          }
        : UNAVAILABLE),
    },
    {
      label: 'Would have avoided',
      info: 'Pages that controls in shadow mode would have held back; nothing was actually suppressed.',
      ...(n
        ? {
            value: formatCount(n.shadowWouldAvoid),
            secondary: 'Shadow mode only: nothing was held back',
          }
        : UNAVAILABLE),
    },
    {
      label: 'First insight (median)',
      info: 'Median time from incident creation to the first Intelligence suggestion, with the 90th percentile beside it.',
      ...(s
        ? {
            value: formatDuration(s.firstInsightP50Seconds),
            secondary:
              s.incidents === 0
                ? 'No incidents in this window'
                : `p90 ${formatDuration(s.firstInsightP90Seconds)} · ${formatCount(s.incidentsWithInsight)} of ${formatCount(s.incidents)} incidents`,
          }
        : UNAVAILABLE),
    },
    {
      label: 'Suggestions accepted',
      info: 'Share of related-incident suggestions that responders accepted, out of those they reviewed.',
      ...(s ? reviewed(s.relatedSuggestions, 'reviewed') : UNAVAILABLE),
    },
    {
      label: 'Rated helpful',
      info: 'Share of similar-incident, cause, change and runbook findings that responders rated helpful.',
      ...(s ? reviewed(s.findings, 'rated') : UNAVAILABLE),
    },
    {
      label: 'Triage accepted',
      info: 'Share of triage suggestions (urgency, owner, duplicate, time to resolve) accepted rather than dismissed.',
      ...(!triageEnabled
        ? { value: NO_VALUE, secondary: triageOff }
        : s
          ? reviewed(s.triage, 'decided')
          : UNAVAILABLE),
    },
    {
      label: 'Mean time to acknowledge',
      info: 'Mean time from creation to first acknowledgement, for incidents created in this window.',
      ...responseTime(outcomes, 'mttaSeconds'),
    },
    {
      label: 'Mean time to resolve',
      info: 'Mean time from creation to resolution, for incidents created in this window.',
      ...responseTime(outcomes, 'mttrSeconds'),
    },
    {
      label: 'False-group rate',
      info: 'Share of alert groupings that responders undid, a sign grouping is too broad.',
      ...(!n
        ? UNAVAILABLE
        : n.grouped === 0
          ? { value: NO_VALUE, secondary: 'No alerts were grouped' }
          : {
              value: formatPercent(n.falseGroupRate),
              secondary: `${formatCount(n.ungrouped)} of ${formatCount(n.grouped)} groupings undone`,
            }),
    },
    {
      label: 'Heartbeat monitors',
      info: 'Heartbeat monitors in scope, and how many are missing or late right now.',
      ...(!n
        ? UNAVAILABLE
        : n.heartbeats.monitors === 0
          ? { value: NO_VALUE, secondary: 'No heartbeat monitors' }
          : {
              value: formatCount(n.heartbeats.monitors),
              secondary: `${formatCount(n.heartbeats.missing)} missing · ${formatCount(n.heartbeats.late)} late`,
            }),
    },
  ];

  return (
    <section aria-labelledby="overview-kpis" className="space-y-2">
      <h2 id="overview-kpis" className="sr-only">
        Key metrics
      </h2>
      <ul className={GRID}>
        {kpis.map(kpi => (
          <li key={kpi.label} className="min-w-0 rounded-lg border bg-card p-3 shadow-sm sm:p-4">
            <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <span className="truncate">{kpi.label}</span>
              <MetricInfo definitions={[{ label: kpi.label, description: kpi.info }]} />
            </div>
            <p
              className={cn(
                'mt-1 font-display text-2xl font-semibold tabular-nums sm:text-3xl',
                kpi.value === NO_VALUE && 'text-muted-foreground'
              )}
            >
              {kpi.value}
            </p>
            <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <DeltaBadge delta={kpi.delta ?? null} />
              <span className="tabular-nums">{kpi.secondary}</span>
            </div>
          </li>
        ))}
      </ul>
      {s?.sampleTruncated && (
        <p className="text-xs text-muted-foreground">
          Insight figures are based on the most recent 5,000 incidents and reviews in this window.
        </p>
      )}
    </section>
  );
}

/** Loading placeholder in the shape of the KPI grid, so the layout doesn't jump. */
export function KpiSkeleton() {
  return (
    <ul role="status" aria-label="Loading key metrics" className={GRID}>
      {Array.from({ length: 12 }, (_, index) => (
        <li key={index} className="h-28 animate-pulse rounded-lg border bg-card shadow-sm" />
      ))}
    </ul>
  );
}
