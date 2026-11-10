import { Fragment, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import prisma from '@/lib/prisma';
import EmptyState from '@/components/ui/EmptyState';
import { loadSection, type SectionResult } from '@/lib/intelligence/overview/scope';
import { RECURRING_WINDOW_DAYS } from '@/lib/intelligence/insights/service';
import {
  SERVICE_INTELLIGENCE_LIMITS,
  getServiceAlertQuality,
  getServiceAutoGate,
  getServiceDependencyNeighbourhood,
  getServiceLearnedFactCount,
  getServiceNoiseStatus,
  getServiceRecentChanges,
  getServiceRecurringProblems,
  getServiceSloBurn,
  type ServiceIntelligenceAccess,
} from '@/lib/intelligence/surfaces/service-intelligence';
import {
  OverviewSection,
  SectionError,
  SectionSkeleton,
} from '@/components/intelligence/overview/primitives';
import {
  AlertQualityPanel,
  AutoGatePanel,
  ChangesPanel,
  DependenciesPanel,
  LearnedFactsPanel,
  NoiseStatusPanel,
  RecurringProblemsPanel,
  SloBurnPanel,
} from '@/components/service/intelligence/ServiceIntelligencePanels';

/**
 * The service page's Intelligence tab. Rendered (and its data loaded) only while the tab is selected, so
 * the other tabs pay nothing for it. Every section loads in parallel through its own fail-soft loader:
 * a failing section shows a one-line error and the rest render. Sections with nothing to say render
 * nothing; when all of them are silent the tab says so once instead of showing empty cards.
 */

function section<T>(
  key: string,
  title: string,
  result: SectionResult<T>,
  render: (data: T) => ReactNode
): ReactNode {
  if (result.ok) {
    const node = render(result.data);
    return node ? <Fragment key={key}>{node}</Fragment> : null;
  }
  return (
    <OverviewSection key={key} id={`service-${key}`} title={title}>
      <SectionError message={result.error} />
    </OverviewSection>
  );
}

export default async function ServiceIntelligenceTab({
  access,
  timeZone,
}: {
  access: ServiceIntelligenceAccess;
  timeZone: string;
}) {
  const { service, canManage } = access;
  const now = new Date();
  const [dependencies, burn, quality, changes, noise, gate, recurring, facts, jira] =
    await Promise.all([
      loadSection('dependencies', () => getServiceDependencyNeighbourhood(access)),
      loadSection('SLO burn', () => getServiceSloBurn(access, now)),
      loadSection('alert quality', () => getServiceAlertQuality(access, now)),
      loadSection('recent changes', () => getServiceRecentChanges(access, now)),
      loadSection('noise controls', () => getServiceNoiseStatus(access, now)),
      loadSection('grouping mode', () => getServiceAutoGate(access, now)),
      loadSection('recurring problems', () => getServiceRecurringProblems(access, now)),
      loadSection('learned facts', () => getServiceLearnedFactCount(access)),
      canManage
        ? prisma.jiraConfig
            .findUnique({ where: { id: 'default' }, select: { enabled: true } })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

  // Panels are hook-free server components, so calling them here tells us which ones are silent.
  const panels = [
    section('slo-burn', 'SLO burn', burn, data => SloBurnPanel({ burn: data })),
    section('dependencies', 'Dependencies', dependencies, data =>
      DependenciesPanel({ data, canManage })
    ),
    section('alert-quality', 'Alert quality', quality, data =>
      AlertQualityPanel({
        quality: data,
        serviceId: service.id,
        serviceName: service.name,
        canManage,
        jiraConfigured: Boolean(jira?.enabled),
      })
    ),
    section('changes', 'Recent changes', changes, data =>
      ChangesPanel({
        changes: data,
        timeZone,
        windowDays: SERVICE_INTELLIGENCE_LIMITS.changeWindowDays,
      })
    ),
    section('noise', 'Noise controls', noise, data =>
      NoiseStatusPanel({ status: data, serviceId: service.id, timeZone, canManage })
    ),
    section('recurring', 'Recurring problems', recurring, data =>
      RecurringProblemsPanel({ problems: data, timeZone, windowDays: RECURRING_WINDOW_DAYS })
    ),
    section('auto-gate', 'Grouping mode', gate, data =>
      AutoGatePanel({ gate: data, serviceName: service.name, canManage })
    ),
    section('learned-facts', 'Learned facts', facts, data =>
      LearnedFactsPanel({ facts: data, serviceId: service.id })
    ),
  ].filter(Boolean);

  if (panels.length === 0)
    return (
      <EmptyState
        size="sm"
        icon={<Sparkles />}
        title="Nothing to report yet"
        description="Dependencies, SLO burn, alert quality, changes and recurring problems appear here once there is data for this service."
      />
    );
  return (
    <div data-testid="service-intelligence" className="grid gap-4 xl:grid-cols-2">
      {panels}
    </div>
  );
}

export function ServiceIntelligenceTabSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionSkeleton title="SLO burn" tiles={2} />
      <SectionSkeleton title="Dependencies" tiles={2} />
      <SectionSkeleton title="Alert quality" tiles={3} />
      <SectionSkeleton title="Noise controls" tiles={3} />
    </div>
  );
}
