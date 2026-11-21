import type { ReactNode } from 'react';
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
}: {
  noise: SectionResult<OverviewNoise>;
  speed: SectionResult<OverviewSpeed>;
  outcomes: SectionResult<OverviewOutcomes>;
  enabled: boolean;
  windowLabel: string;
}) {
  const n = noise.ok ? noise.data : null;
  const s = speed.ok ? speed.data : null;

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
      <p className="max-w-prose text-base text-foreground">
        {impactSentences({ enabled, speed, noise }).join(' ')}
      </p>
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
              valueClassName="break-words"
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
