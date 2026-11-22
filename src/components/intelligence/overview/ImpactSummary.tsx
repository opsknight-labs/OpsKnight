import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import DeltaBadge from '@/components/analytics/DeltaBadge';
import MetricInfo from '@/components/analytics/MetricInfo';
import { describeDelta } from '@/components/analytics/format';
import { KPI_CARD, KPI_GRID, KpiBody, KpiGridSkeleton } from '@/components/analytics/KpiCard';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import type { OverviewNoise } from '@/lib/intelligence/overview/noise';
import type { OverviewOutcomes } from '@/lib/intelligence/overview/outcomes';
import type { SectionResult } from '@/lib/intelligence/overview/scope';
import type { OverviewSpeed } from '@/lib/intelligence/overview/speed';
import { formatCount, formatDuration } from '@/lib/intelligence/overview/window';
import { NO_VALUE } from './primitives';

interface Headline {
  label: string;
  /** One sentence for the info tooltip. */
  info: string;
  value: ReactNode;
  /** What a screen reader hears instead of the visual value, when they differ. */
  spoken?: string;
  secondary: ReactNode;
  delta?: ReturnType<typeof describeDelta>;
}

const UNAVAILABLE = { value: NO_VALUE, secondary: 'Unavailable' };
const count = (value: number, noun: string) =>
  `${formatCount(value)} ${noun}${value === 1 ? '' : 's'}`;

/**
 * The plain-language answer to "is Intelligence helping?", built only from the loaded numbers. A failed
 * loader drops its sentence rather than guessing; off and empty states say why nothing happened.
 */
export function impactSentences({
  enabled,
  speed,
  noise,
}: {
  enabled: boolean;
  speed: SectionResult<OverviewSpeed>;
  noise: SectionResult<OverviewNoise>;
}): string[] {
  const out: string[] = [];
  if (!enabled) {
    out.push('Intelligence is off, so no insights were generated in this window.');
  } else if (speed.ok) {
    const s = speed.data;
    if (s.incidents === 0)
      out.push('No incidents opened in this window, so Intelligence had nothing to look at.');
    else if (s.incidentsWithInsight === 0)
      out.push(
        `Intelligence found no insights for the ${count(s.incidents, 'incident')} in this window.`
      );
    else
      out.push(
        `Intelligence found insights for ${formatCount(s.incidentsWithInsight)} of ${count(s.incidents, 'incident')}${
          s.firstInsightP50Seconds === null
            ? '.'
            : `, a median of ${formatDuration(s.firstInsightP50Seconds)} after they opened.`
        }`
      );
  }
  if (noise.ok) {
    const n = noise.data;
    if (n.modes.on > 0)
      out.push(
        n.pagesAvoided > 0
          ? `Noise controls held back ${count(n.pagesAvoided, 'page')}.`
          : 'Noise controls are on but held nothing back.'
      );
    else if (n.modes.shadow > 0)
      out.push(
        n.shadowWouldAvoid > 0
          ? `Noise controls are in shadow mode: they would have held back ${count(n.shadowWouldAvoid, 'page')}, but nothing was held back.`
          : 'Noise controls are in shadow mode: nothing was held back.'
      );
    else out.push('Noise controls are off, so nothing was held back.');
  }
  if (out.length === 0) out.push('These figures could not be loaded. Refresh to try again.');
  return out;
}

/** The insight sentence with its numbers emphasised; other states read as plain sentences. */
function InsightLine({
  enabled,
  speed,
  fallback,
}: {
  enabled: boolean;
  speed: SectionResult<OverviewSpeed>;
  fallback: string | undefined;
}) {
  const s = enabled && speed.ok ? speed.data : null;
  if (!s || s.incidents === 0 || s.incidentsWithInsight === 0)
    return fallback ? <p className="text-base text-foreground">{fallback}</p> : null;
  return (
    <p className="text-base text-muted-foreground">
      Intelligence found insights for{' '}
      <strong className="font-semibold text-foreground tabular-nums">
        {formatCount(s.incidentsWithInsight)} of {count(s.incidents, 'incident')}
      </strong>
      {s.firstInsightP50Seconds === null ? (
        '.'
      ) : (
        <>
          , a median of{' '}
          <strong className="font-semibold text-foreground tabular-nums">
            {formatDuration(s.firstInsightP50Seconds)}
          </strong>{' '}
          after they opened.
        </>
      )}
    </p>
  );
}

/** How much of the window Intelligence covered, as a quiet bar under the sentence. */
function Coverage({ speed, enabled }: { speed: SectionResult<OverviewSpeed>; enabled: boolean }) {
  if (!enabled || !speed.ok || speed.data.incidents === 0) return null;
  const pct = Math.round((speed.data.incidentsWithInsight / speed.data.incidents) * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {pct}% of incidents got an insight
      </span>
    </div>
  );
}

/** Noise controls' mode as a status pill, with what they did in one short line. */
function NoiseStatus({
  noise,
  canManage,
}: {
  noise: SectionResult<OverviewNoise>;
  canManage: boolean;
}) {
  if (!noise.ok) return null;
  const n = noise.data;
  const state =
    n.modes.on > 0
      ? {
          tone: 'ok' as const,
          label: 'Noise controls on',
          detail:
            n.pagesAvoided > 0
              ? `Held back ${count(n.pagesAvoided, 'page')}`
              : 'Nothing held back yet',
        }
      : n.modes.shadow > 0
        ? {
            tone: 'info' as const,
            label: 'Shadow mode',
            detail:
              n.shadowWouldAvoid > 0
                ? `Would have held back ${count(n.shadowWouldAvoid, 'page')}`
                : 'Recording only: nothing held back',
          }
        : { tone: 'neutral' as const, label: 'Noise controls off', detail: 'Not reducing pages' };
  const tone = toneClasses(state.tone);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5 border-t pt-3 sm:items-end sm:border-0 sm:pt-0">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
          tone.soft
        )}
      >
        <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', tone.solid)} />
        {state.label}
      </span>
      <span className="text-xs text-muted-foreground">{state.detail}</span>
      {canManage && (
        <Link
          href="/settings/intelligence/noise-controls"
          className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
        >
          Review noise controls
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function responseTime(
  outcomes: SectionResult<OverviewOutcomes>,
  key: 'mttaSeconds' | 'mttrSeconds'
): Pick<Headline, 'value' | 'secondary' | 'delta'> {
  if (!outcomes.ok) return UNAVAILABLE;
  const { current, previous } = outcomes.data;
  const done = key === 'mttaSeconds' ? current.acknowledged : current.resolved;
  const verb = key === 'mttaSeconds' ? 'acknowledged' : 'resolved';
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, not user input
  const now = current[key];
  return {
    value: formatDuration(now),
    // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, not user input
    delta: describeDelta(now, previous[key], 'duration', 'down'),
    secondary: now === null ? `No incidents ${verb} yet` : `${formatCount(done)} ${verb}`,
  };
}

/**
 * The overview's answer: a lead sentence on what Intelligence and the noise controls did, then the four
 * headline numbers as Analytics KPI tiles (same grid, size and type). Secondary rates live in the Feedback
 * card.
 */
export default function ImpactSummary({
  noise,
  speed,
  outcomes,
  enabled,
  windowLabel,
  canManage = false,
}: {
  noise: SectionResult<OverviewNoise>;
  speed: SectionResult<OverviewSpeed>;
  outcomes: SectionResult<OverviewOutcomes>;
  enabled: boolean;
  windowLabel: string;
  canManage?: boolean;
}) {
  const n = noise.ok ? noise.data : null;
  const s = speed.ok ? speed.data : null;
  // Only the insight/off/empty sentence is shown as text; noise controls get their own status block.
  const sentences = impactSentences({ enabled, speed, noise: { ok: false, error: '' } });

  const headlines: Headline[] = [
    {
      label: 'Alerts to incidents',
      info: 'Alerts that reached OpsKnight for the services in scope, and the incidents they became; more alerts per incident means more were grouped.',
      ...(n
        ? {
            value: (
              <>
                {/* Spaces, not padding, around the arrow so a wide pair can wrap in a narrow cell. */}
                {formatCount(n.alerts)} <span className="font-normal text-muted-foreground">→</span>{' '}
                {formatCount(n.incidents)}
              </>
            ),
            spoken: `${count(n.alerts, 'alert')} became ${count(n.incidents, 'incident')}`,
            secondary:
              n.incidents === 0
                ? 'No incidents created'
                : `${n.compressionRatio.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} alerts per incident`,
          }
        : UNAVAILABLE),
    },
    {
      label: 'Time to first insight',
      info: 'Median time from incident creation to the first Intelligence suggestion, with the 90th percentile and how many incidents got one.',
      ...(!enabled
        ? { value: NO_VALUE, secondary: 'Intelligence is off' }
        : !s
          ? UNAVAILABLE
          : s.incidents === 0
            ? { value: NO_VALUE, secondary: 'No incidents in this window' }
            : {
                value: formatDuration(s.firstInsightP50Seconds),
                secondary: `p90 ${formatDuration(s.firstInsightP90Seconds)} · ${formatCount(s.incidentsWithInsight)} of ${formatCount(s.incidents)} incidents`,
              }),
    },
    {
      label: 'MTTA',
      info: 'Mean time to acknowledge: from creation to first acknowledgement, for incidents created in this window.',
      ...responseTime(outcomes, 'mttaSeconds'),
    },
    {
      label: 'MTTR',
      info: 'Mean time to resolve: from creation to resolution, for incidents created in this window.',
      ...responseTime(outcomes, 'mttrSeconds'),
    },
  ];

  return (
    <section aria-labelledby="overview-impact" className="space-y-3">
      <h2 id="overview-impact" className="sr-only">
        Impact, {windowLabel.toLowerCase()}
      </h2>
      <div
        className={cn(
          KPI_CARD,
          'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6'
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-2">
            <InsightLine enabled={enabled} speed={speed} fallback={sentences[0]} />
            <Coverage speed={speed} enabled={enabled} />
          </div>
        </div>
        <NoiseStatus noise={noise} canManage={canManage} />
      </div>
      <ul className={KPI_GRID}>
        {headlines.map(item => (
          <li key={item.label} className={KPI_CARD}>
            <KpiBody
              label={item.label}
              info={<MetricInfo definitions={[{ label: item.label, description: item.info }]} />}
              value={
                item.spoken ? (
                  <>
                    <span aria-hidden="true">{item.value}</span>
                    <span className="sr-only">{item.spoken}</span>
                  </>
                ) : (
                  item.value
                )
              }
              empty={item.value === NO_VALUE}
              valueClassName="wrap-break-word"
              meta={
                <>
                  <DeltaBadge delta={item.delta ?? null} />
                  <span className="tabular-nums">{item.secondary}</span>
                </>
              }
            />
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

/** Loading placeholder in the shape of the lead sentence and KPI grid, so the layout doesn't jump. */
export function ImpactSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-full max-w-prose" />
      <KpiGridSkeleton count={4} />
    </div>
  );
}
