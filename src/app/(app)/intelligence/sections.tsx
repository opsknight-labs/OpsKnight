import { cache } from 'react';
import {
  Activity,
  Brain,
  Gauge,
  GitCommitHorizontal,
  Timer,
  TrendingUp,
  Volume2,
} from 'lucide-react';
import { PageHeader } from '@/components/patterns';
import type { DetailStatItem } from '@/components/ui/DetailHeroBanner';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import { listInsightsInbox } from '@/lib/intelligence/ops-insights/view';
import {
  getOverviewAttention,
  getOverviewChange,
  getOverviewHealth,
  getOverviewNoise,
  getOverviewOutcomes,
  getOverviewQuality,
  getOverviewSpeed,
  loadSection,
  type OverviewScope,
  type OverviewStatus,
  type OverviewWindow,
} from '@/lib/intelligence/overview';
import ChangePanel from '@/components/intelligence/overview/ChangePanel';
import HealthPanel from '@/components/intelligence/overview/HealthPanel';
import NeedsAttention from '@/components/intelligence/overview/NeedsAttention';
import NoisePanel from '@/components/intelligence/overview/NoisePanel';
import OutcomesPanel from '@/components/intelligence/overview/OutcomesPanel';
import QualityPanel from '@/components/intelligence/overview/QualityPanel';
import SpeedPanel from '@/components/intelligence/overview/SpeedPanel';
import WindowSelector from '@/components/intelligence/overview/WindowSelector';
import {
  NO_VALUE,
  OverviewSection,
  SectionError,
} from '@/components/intelligence/overview/primitives';
import { formatCount, formatDuration, formatPercent } from '@/lib/intelligence/overview/window';

/**
 * One async server component per overview section. Each loads its own data through a fail-soft loader
 * and streams in behind its own Suspense boundary, so a slow or failing section never holds back or
 * breaks the others.
 */

interface SectionProps {
  scope: OverviewScope;
  range: OverviewWindow;
  canManage: boolean;
  status: OverviewStatus;
}

const ATTENTION_INSIGHT_LIMIT = 10;

// One read per request: the header's stat strip and the Noise/Speed cards share these. `cache` keys on the
// argument identity, so callers pass the same `scope` and `range` objects the page built.
const loadNoise = cache((scope: OverviewScope, range: OverviewWindow) =>
  loadSection('noise', () => getOverviewNoise(scope, range))
);
const loadSpeed = cache((scope: OverviewScope, range: OverviewWindow) =>
  loadSection('speed', () => getOverviewSpeed(scope, range))
);

const HEADER_STAT_LABELS = [
  'Alerts received',
  'Pages avoided',
  'First insight, median',
  'Suggestions accepted',
] as const;

/**
 * The overview's page band: eyebrow, title, the window selector as its action and the headline numbers.
 * `stats` is null while they load (the strip shows placeholders), so the band never shifts.
 */
export function OverviewHeader({
  scope,
  range,
  stats,
}: {
  scope: OverviewScope;
  range: OverviewWindow;
  stats: DetailStatItem[] | null;
}) {
  return (
    <PageHeader
      eyebrow="AIOps"
      title="AIOps overview"
      icon={Brain}
      description={
        <>
          <p>
            What Intelligence and the noise controls did for the incidents you can see: noise held
            back, how quickly suggestions arrived and how often they helped.
          </p>
          {!scope.global && (
            <p className="mt-1 text-xs">
              Showing your teams&apos; services and incidents only.
              {scope.servicesTruncated && ' Limited to the first 2,000 services.'}
            </p>
          )}
        </>
      }
      primaryAction={<WindowSelector current={range.key} />}
      stats={
        stats ?? HEADER_STAT_LABELS.map(label => ({ label, value: NO_VALUE, subtext: 'Loading' }))
      }
    />
  );
}

/** The header with its stat strip filled from the Noise and Speed loaders (shared with their cards). */
export async function OverviewHeaderWithStats({ scope, range }: SectionProps) {
  const [noise, speed] = await Promise.all([loadNoise(scope, range), loadSpeed(scope, range)]);
  const unavailable = { value: NO_VALUE, subtext: 'Unavailable' };
  const stats: DetailStatItem[] = [
    {
      label: HEADER_STAT_LABELS[0],
      ...(noise.ok
        ? {
            value: formatCount(noise.data.alerts),
            subtext: `${formatCount(noise.data.incidents)} incidents created`,
          }
        : unavailable),
    },
    {
      label: HEADER_STAT_LABELS[1],
      ...(noise.ok
        ? { value: formatCount(noise.data.pagesAvoided), subtext: 'Held back by noise controls' }
        : unavailable),
    },
    {
      label: HEADER_STAT_LABELS[2],
      ...(speed.ok
        ? {
            value: formatDuration(speed.data.firstInsightP50Seconds),
            subtext:
              speed.data.incidents === 0
                ? 'No incidents in this window'
                : `${formatCount(speed.data.incidentsWithInsight)} of ${formatCount(speed.data.incidents)} incidents`,
          }
        : unavailable),
    },
    {
      label: HEADER_STAT_LABELS[3],
      ...(speed.ok
        ? {
            value: formatPercent(speed.data.relatedSuggestions.rate),
            subtext:
              speed.data.relatedSuggestions.reviewed === 0
                ? 'None reviewed yet'
                : `${formatCount(speed.data.relatedSuggestions.accepted)} of ${formatCount(speed.data.relatedSuggestions.reviewed)} reviewed`,
          }
        : unavailable),
    },
  ];
  return <OverviewHeader scope={scope} range={range} stats={stats} />;
}

export const SECTION_TITLES = {
  noise: 'Noise',
  speed: 'Speed',
  quality: 'Alert quality',
  change: 'Changes',
  outcomes: 'Outcomes',
  health: 'Lane health',
} as const;

/**
 * The one "Needs attention" inbox: the overview's decision probes and the open operations insights, ranked
 * together. Absent when there is nothing to act on; either source failing drops out on its own (the probes
 * inside their loader, the insights here), so this section never renders an error or an empty card.
 */
export async function AttentionSection({
  actor,
  resolveHref,
}: {
  actor: AuthorizationActor;
  resolveHref?: (href: string) => string;
}) {
  const [result, inbox] = await Promise.all([
    loadSection('needs attention', () => getOverviewAttention(actor)),
    loadSection('operations insights', () =>
      listInsightsInbox(actor, { limit: ATTENTION_INSIGHT_LIMIT })
    ),
  ]);
  const items = result.ok ? result.data.items : [];
  const insights = inbox.ok ? inbox.data.items : [];
  if (items.length === 0 && insights.length === 0) return null;
  // The assistant hand-off only shows while Squire is on; a failed status read just hides it.
  const squire = insights.length > 0 ? await getAiPublicStatus().catch(() => null) : null;
  return (
    <NeedsAttention
      items={items}
      insights={insights}
      moreInsights={inbox.ok && inbox.data.nextCursor !== null}
      canDecide={hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)}
      squireName={squire?.squireEnabled ? squire.squireName : null}
      resolveHref={resolveHref}
    />
  );
}

export async function NoiseSection({ scope, range, canManage }: SectionProps) {
  const result = await loadNoise(scope, range);
  return (
    <OverviewSection
      id="overview-noise"
      icon={<Volume2 />}
      drilldown={{ href: '/alerts', label: 'View alerts' }}
      title={SECTION_TITLES.noise}
      description="Alerts received against incidents created, and what noise controls held back."
      footer="Shadow decisions show what would have happened and are never counted as avoided pages."
    >
      {result.ok ? (
        <NoisePanel data={result.data} windowLabel={range.label} canManage={canManage} />
      ) : (
        <SectionError message={result.error} />
      )}
    </OverviewSection>
  );
}

export async function SpeedSection({ scope, range, canManage, status }: SectionProps) {
  const result = await loadSpeed(scope, range);
  return (
    <OverviewSection
      id="overview-speed"
      icon={<Timer />}
      drilldown={{ href: '/incidents', label: 'View incidents' }}
      title={SECTION_TITLES.speed}
      description="How soon Intelligence offered its first suggestion, and how often responders accepted what it suggested."
    >
      {result.ok ? (
        <SpeedPanel
          data={result.data}
          windowLabel={range.label}
          triageEnabled={status.triageEnabled}
          canManage={canManage}
        />
      ) : (
        <SectionError message={result.error} />
      )}
    </OverviewSection>
  );
}

export async function QualitySection({
  actor,
  canManage,
  range,
}: SectionProps & { actor: AuthorizationActor }) {
  const result = await loadSection('alert quality', () => getOverviewQuality(actor, range.until));
  return (
    <OverviewSection
      id="overview-quality"
      icon={<Gauge />}
      drilldown={{ href: '/services', label: 'View services' }}
      title={SECTION_TITLES.quality}
      description="Services whose incidents mostly clear on their own, go unacknowledged or flap, over the last 30 days."
    >
      {result.ok ? (
        <QualityPanel data={result.data} canManage={canManage} />
      ) : (
        <SectionError message={result.error} />
      )}
    </OverviewSection>
  );
}

export async function ChangeSection({ scope, range, canManage, status }: SectionProps) {
  const result = await loadSection('changes', () => getOverviewChange(scope, range));
  return (
    <OverviewSection
      id="overview-change"
      icon={<GitCommitHorizontal />}
      drilldown={{ href: '/changes', label: 'View changes' }}
      title={SECTION_TITLES.change}
      description="Incidents with a suggested change cause, and the changes most likely to be followed by one."
      footer="Risk is a ranking signal to help you look in the right place, never a verdict."
    >
      {result.ok ? (
        <ChangePanel
          data={result.data}
          windowLabel={range.label}
          responseEnabled={status.responseEnabled}
          canManage={canManage}
        />
      ) : (
        <SectionError message={result.error} />
      )}
    </OverviewSection>
  );
}

export async function OutcomesSection({ scope, range }: SectionProps) {
  const result = await loadSection('outcomes', () => getOverviewOutcomes(scope, range));
  return (
    <OverviewSection
      id="overview-outcomes"
      icon={<TrendingUp />}
      drilldown={{ href: '/insights', label: 'Open analytics' }}
      title={SECTION_TITLES.outcomes}
      description="Mean time to acknowledge and resolve for incidents created in this window, compared with the window before it."
      className="lg:col-span-2"
    >
      {result.ok ? (
        <OutcomesPanel data={result.data} windowKey={range.key} since={range.since} />
      ) : (
        <SectionError message={result.error} />
      )}
    </OverviewSection>
  );
}

export async function HealthSection({ actor }: SectionProps & { actor: AuthorizationActor }) {
  const result = await loadSection('lane health', () => getOverviewHealth(actor));
  if (result.ok && result.data === null) return null;
  return (
    <OverviewSection
      id="overview-health"
      icon={<Activity />}
      title={SECTION_TITLES.health}
      description="Whether the Intelligence lane is running here, and how much work is waiting."
      footer="Visible to administrators. Intelligence runs off the paging path; a degraded lane never delays notifications."
      className="lg:col-span-2"
    >
      {result.ok && result.data ? (
        <HealthPanel data={result.data} />
      ) : (
        <SectionError message={result.ok ? 'Unavailable.' : result.error} />
      )}
    </OverviewSection>
  );
}
