import { cache } from 'react';
import { Volume2 } from 'lucide-react';
import MetricInfo from '@/components/analytics/MetricInfo';
import { SectionCard } from '@/components/analytics/SectionCard';
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
import FeedbackPanel from '@/components/intelligence/overview/FeedbackPanel';
import HealthPanel from '@/components/intelligence/overview/HealthPanel';
import ImpactSummary from '@/components/intelligence/overview/ImpactSummary';
import NeedsAttention from '@/components/intelligence/overview/NeedsAttention';
import NoisePanel, { NoiseControls } from '@/components/intelligence/overview/NoisePanel';
import OutcomeTrends from '@/components/intelligence/overview/OutcomeTrends';
import QualityPanel from '@/components/intelligence/overview/QualityPanel';
import {
  DrilldownLink,
  OverviewSection,
  SectionError,
} from '@/components/intelligence/overview/primitives';

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

// One read per request: the impact card, the feedback card, the trend and the noise sections share these. `cache` keys on
// the argument identity, so callers pass the same `scope` and `range` objects the page built.
const loadNoise = cache((scope: OverviewScope, range: OverviewWindow) =>
  loadSection('noise', () => getOverviewNoise(scope, range))
);
const loadSpeed = cache((scope: OverviewScope, range: OverviewWindow) =>
  loadSection('speed', () => getOverviewSpeed(scope, range))
);
const loadOutcomes = cache((scope: OverviewScope, range: OverviewWindow) =>
  loadSection('outcomes', () => getOverviewOutcomes(scope, range))
);

/** Header info button: one sentence on what a section counts. */
const info = (label: string, description: string) => (
  <MetricInfo definitions={[{ label, description }]} />
);

export const SECTION_TITLES = {
  noise: 'Noise',
  noiseControls: 'Noise controls',
  trend: 'Response trend',
  feedback: 'Feedback and quality',
  quality: 'Alert quality',
  change: 'Changes',
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

/** The mobile page's Noise card: totals and the noise-control breakdown in one card. */
export async function NoiseSection({ scope, range, canManage }: SectionProps) {
  const result = await loadNoise(scope, range);
  return (
    <OverviewSection
      id="overview-noise"
      icon={<Volume2 />}
      drilldown={{ href: '/alerts', label: 'View alerts' }}
      title={SECTION_TITLES.noise}
      description="Alerts received, incidents created and what noise controls held back."
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

/** The answer card: a plain-language summary and the four headline numbers. */
export async function ImpactSection({ scope, range, status }: SectionProps) {
  const [noise, speed, outcomes] = await Promise.all([
    loadNoise(scope, range),
    loadSpeed(scope, range),
    loadOutcomes(scope, range),
  ]);
  return (
    <ImpactSummary
      noise={noise}
      speed={speed}
      outcomes={outcomes}
      enabled={status.enabled}
      windowLabel={range.label}
    />
  );
}

/** Responder feedback and the secondary noise numbers, as one compact list beside the trend. */
export async function FeedbackSection({ scope, range, canManage, status }: SectionProps) {
  const [noise, speed] = await Promise.all([loadNoise(scope, range), loadSpeed(scope, range)]);
  return (
    <SectionCard
      id="overview-feedback"
      title={SECTION_TITLES.feedback}
      description="How responders rated Intelligence, and how grouping and noise controls behaved."
    >
      <FeedbackPanel
        noise={noise}
        speed={speed}
        triageEnabled={status.triageEnabled}
        canManage={canManage}
      />
    </SectionCard>
  );
}

/** MTTA or MTTR per period against the previous window, in one card two thirds wide from lg. */
export async function TrendSection({ scope, range }: SectionProps) {
  const result = await loadOutcomes(scope, range);
  if (!result.ok)
    return (
      <SectionCard id="overview-trends" title={SECTION_TITLES.trend} className="lg:col-span-2">
        <SectionError message={result.error} />
      </SectionCard>
    );
  return (
    <OutcomeTrends
      data={result.data}
      windowKey={range.key}
      since={range.since}
      className="lg:col-span-2"
    />
  );
}

/** Desktop noise card: what suppression rules and maintenance windows held back (the KPIs carry the totals). */
export async function NoiseControlsSection({ scope, range, canManage }: SectionProps) {
  const result = await loadNoise(scope, range);
  return (
    <SectionCard
      id="overview-noise"
      title={SECTION_TITLES.noiseControls}
      description="Alerts held back by suppression rules and maintenance windows in this window."
      info={info(
        SECTION_TITLES.noiseControls,
        'Shadow decisions show what would have happened and are never counted as avoided pages.'
      )}
      actions={<DrilldownLink id="overview-noise" href="/alerts" label="View alerts" />}
    >
      {result.ok ? (
        <NoiseControls data={result.data} canManage={canManage} />
      ) : (
        <SectionError message={result.error} />
      )}
    </SectionCard>
  );
}

export async function QualitySection({
  actor,
  canManage,
  range,
}: SectionProps & { actor: AuthorizationActor }) {
  const result = await loadSection('alert quality', () => getOverviewQuality(actor, range.until));
  return (
    <SectionCard
      id="overview-quality"
      title={SECTION_TITLES.quality}
      description="Services that self-clear, go unacknowledged or flap, over the last 30 days."
      info={info(
        SECTION_TITLES.quality,
        'Ranks services by alerts that self-clear, go unacknowledged or flap; always the last 30 days, whatever the window.'
      )}
      actions={<DrilldownLink id="overview-quality" href="/services" label="View services" />}
    >
      {result.ok ? (
        <QualityPanel data={result.data} canManage={canManage} />
      ) : (
        <SectionError message={result.error} />
      )}
    </SectionCard>
  );
}

export async function ChangeSection({ scope, range, canManage, status }: SectionProps) {
  const result = await loadSection('changes', () => getOverviewChange(scope, range));
  return (
    <SectionCard
      id="overview-change"
      title={SECTION_TITLES.change}
      description="Incidents linked to a likely change, and the riskiest recent changes."
      info={info(
        SECTION_TITLES.change,
        'Risk is a ranking signal to help you look in the right place, never a verdict.'
      )}
      actions={<DrilldownLink id="overview-change" href="/changes" label="View changes" />}
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
    </SectionCard>
  );
}

export async function HealthSection({ actor }: SectionProps & { actor: AuthorizationActor }) {
  const result = await loadSection('lane health', () => getOverviewHealth(actor));
  if (result.ok && result.data === null) return null;
  return (
    <SectionCard
      id="overview-health"
      title={SECTION_TITLES.health}
      description="Whether the Intelligence lane is running here, and how much work is waiting. Visible to administrators."
      info={info(
        SECTION_TITLES.health,
        'Intelligence runs off the paging path; a degraded lane never delays notifications.'
      )}
    >
      {result.ok && result.data ? (
        <HealthPanel data={result.data} />
      ) : (
        <SectionError message={result.ok ? 'Unavailable.' : result.error} />
      )}
    </SectionCard>
  );
}
