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
import { OverviewSection, SectionError } from '@/components/intelligence/overview/primitives';

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
  const result = await loadSection('noise', () => getOverviewNoise(scope, range));
  return (
    <OverviewSection
      id="overview-noise"
      drilldown={{ href: '/alerts', label: 'View alerts' }}
      title={SECTION_TITLES.noise}
      description="Alerts received against incidents created, and what noise controls held back. Shadow decisions show what would have happened and are never counted as avoided pages."
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
  const result = await loadSection('speed', () => getOverviewSpeed(scope, range));
  return (
    <OverviewSection
      id="overview-speed"
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
      drilldown={{ href: '/changes', label: 'View changes' }}
      title={SECTION_TITLES.change}
      description="Incidents with a suggested change cause, and the changes most likely to be followed by an incident. Risk is a ranking signal, never a verdict."
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
      title={SECTION_TITLES.health}
      description="Visible to administrators. Intelligence runs off the paging path; a degraded lane never delays notifications."
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
