import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { getLiveDashboardSnapshot } from '@/lib/dashboard/live-incidents';
import { liveQueryFromParams, parseHistoryRange } from '@/lib/dashboard/live-incidents-shared';
import { logger } from '@/lib/logger';
import { LiveDashboardProvider } from '@/components/dashboard/live/LiveDashboardProvider';
import LiveCommandStrip from '@/components/dashboard/live/LiveCommandStrip';
import DashboardCockpit from '@/components/dashboard/live/DashboardCockpit';
import LiveIncidentsPanel from '@/components/dashboard/live/LiveIncidentsPanel';
import { OpsPulsePanel } from '@/components/dashboard/live/ResponderRail';
import DashboardHistorySection, {
  DashboardHistoryProvider,
} from '@/components/dashboard/DashboardHistorySection';

export const revalidate = 0;

type SearchParams = { [key: string]: string | string[] | undefined };

function toUrlParams(params: SearchParams): URLSearchParams {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 0) url.set(key, value);
  }
  return url;
}

/**
 * Incident command dashboard.
 *
 * Server render is limited to what is above the fold: one shared, authorization-scoped live
 * snapshot (feed + counters + rail), cached muted counts and the scoped service/team directory
 * for filters. Live data then reconciles through the shared SSE signal; history loads lazily.
 */
export default async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const urlParams = toUrlParams(await searchParams);
  const requestContext = await getRequestActorContext();
  if (!requestContext) redirect('/login?error=SessionExpired');

  const { actor, user } = requestContext;
  // Legacy entry point: the wallboard is a dedicated, chrome-free route.
  if (urlParams.get('view') === 'wallboard') {
    urlParams.delete('view');
    const rest = urlParams.toString();
    redirect(rest ? `/wallboard?${rest}` : '/wallboard');
  }
  const liveQuery = liveQueryFromParams(urlParams);
  const historyQuery = { range: parseHistoryRange(urlParams.get('range')) };
  const generation = await getRealtimeChangeGeneration().catch(() => null);

  const [snapshot, services, teams] = await Promise.all([
    getLiveDashboardSnapshot(actor, liveQuery, { generation }).catch(error => {
      logger.warn('dashboard.live.initial_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
    prisma.service.findMany({
      where: serviceReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      where: teamReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const scopeMode = hasCapability(actor.role, CAPABILITIES.INCIDENT_READ_ALL)
    ? ('GLOBAL' as const)
    : actor.teamIds.length > 0 || (snapshot?.summary.active ?? 0) > 0
      ? ('SCOPED' as const)
      : ('NONE' as const);
  const timeZone = user.timeZone || 'UTC';

  const canAcknowledge =
    hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE) ||
    hasCapability(actor.role, CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED);
  const canAssignSelf = hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE);
  const currentUserName = user.name || user.email;

  return (
    <DashboardHistoryProvider initialQuery={historyQuery}>
      <LiveDashboardProvider
        initialSnapshot={snapshot}
        currentUserId={user.id}
        currentUserName={currentUserName}
        canAcknowledge={canAcknowledge}
        canAssignSelf={canAssignSelf}
      >
        <div className="w-full space-y-4 px-3 py-3 sm:px-4 md:px-6 lg:px-6">
          <LiveCommandStrip scopeMode={scopeMode} timeZone={timeZone} />

          <DashboardCockpit
            feed={
              <LiveIncidentsPanel
                services={services}
                teams={teams}
                canAcknowledge={canAcknowledge}
                canAssignSelf={canAssignSelf}
                canExport={hasCapability(actor.role, CAPABILITIES.REPORT_EXPORT)}
                currentUserName={currentUserName}
              />
            }
            rail={<OpsPulsePanel />}
          />

          <DashboardHistorySection />
        </div>
      </LiveDashboardProvider>
    </DashboardHistoryProvider>
  );
}
