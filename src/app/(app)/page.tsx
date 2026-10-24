import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { getCachedDashboardMetrics } from '@/lib/realtime-cache';
import { getLiveDashboardSnapshot } from '@/lib/dashboard/live-incidents';
import { liveQueryFromParams } from '@/lib/dashboard/live-incidents-shared';
import { logger } from '@/lib/logger';
import { LiveDashboardProvider } from '@/components/dashboard/live/LiveDashboardProvider';
import LiveCommandStrip from '@/components/dashboard/live/LiveCommandStrip';
import LiveIncidentsPanel from '@/components/dashboard/live/LiveIncidentsPanel';
import LiveWallboard from '@/components/dashboard/live/LiveWallboard';
import {
  ActivityCard,
  MyQueueCard,
  OnCallCard,
  ServicesAtRiskStrip,
  SlaRiskCard,
} from '@/components/dashboard/live/ResponderRail';
import DashboardHistorySection, {
  DashboardHistoryProvider,
  type HistoryQuery,
} from '@/components/dashboard/DashboardHistorySection';

export const revalidate = 0;

type SearchParams = { [key: string]: string | string[] | undefined };

function single(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseHistoryQuery(params: SearchParams): HistoryQuery {
  const range = single(params, 'range');
  const service = single(params, 'service');
  const urgency = single(params, 'urgency');
  return {
    range: range === '7' || range === '90' || range === 'all' || range === 'custom' ? range : '30',
    startDate: range === 'custom' ? single(params, 'startDate') : undefined,
    endDate: range === 'custom' ? single(params, 'endDate') : undefined,
    service: service && /^[A-Za-z0-9_-]{1,100}$/.test(service) ? service : undefined,
    urgency: urgency === 'HIGH' || urgency === 'MEDIUM' || urgency === 'LOW' ? urgency : undefined,
  };
}

/**
 * Incident command dashboard.
 *
 * Server render is limited to what is above the fold: one shared, authorization-scoped live
 * snapshot (feed + counters + rail), cached muted counts and the scoped service/team directory
 * for filters. Live data then reconciles through the shared SSE signal; history loads lazily.
 */
export default async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const requestContext = await getRequestActorContext();
  if (!requestContext) redirect('/login?error=SessionExpired');

  const { actor, user } = requestContext;
  const wallboard = single(params, 'view') === 'wallboard';
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') urlParams.set(key, value);
  }
  const liveQuery = liveQueryFromParams(urlParams);
  const historyQuery = parseHistoryQuery(params);
  const generation = await getRealtimeChangeGeneration().catch(() => null);

  const [snapshot, services, teams, metrics] = await Promise.all([
    getLiveDashboardSnapshot(actor, liveQuery, { generation }).catch(error => {
      logger.warn('dashboard.live.initial_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
    wallboard
      ? Promise.resolve([])
      : prisma.service.findMany({
          where: serviceReadWhere(actor),
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
    wallboard
      ? Promise.resolve([])
      : prisma.team.findMany({
          where: teamReadWhere(actor),
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
    getCachedDashboardMetrics(actor.id, actor.role, [...actor.teamIds], undefined, generation)
      .then(result => result?.data ?? null)
      .catch(() => null),
  ]);

  const scopeMode = hasCapability(actor.role, CAPABILITIES.INCIDENT_READ_ALL)
    ? ('GLOBAL' as const)
    : actor.teamIds.length > 0 || (snapshot?.summary.active ?? 0) > 0
      ? ('SCOPED' as const)
      : ('NONE' as const);
  const timeZone = user.timeZone || 'UTC';

  return (
    <DashboardHistoryProvider initialQuery={historyQuery}>
      <LiveDashboardProvider initialSnapshot={snapshot} currentUserId={user.id}>
        {wallboard ? (
          <LiveWallboard timeZone={timeZone} />
        ) : (
          <div className="w-full min-h-screen space-y-4 px-3 py-4 sm:space-y-5 sm:px-4 sm:py-5 md:px-6 lg:px-8">
            <LiveCommandStrip
              scopeMode={scopeMode}
              timeZone={timeZone}
              canCreate={
                hasCapability(actor.role, CAPABILITIES.INCIDENT_CREATE_ALL) ||
                hasCapability(actor.role, CAPABILITIES.INCIDENT_CREATE_SCOPED)
              }
              initialMuted={{
                snoozed: metrics?.snoozed ?? 0,
                suppressed: metrics?.suppressed ?? 0,
              }}
            />

            <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="min-w-0">
                <LiveIncidentsPanel
                  services={services}
                  teams={teams}
                  canAcknowledge={hasCapability(
                    actor.role,
                    CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED
                  )}
                  canAssignSelf={hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE)}
                  canExport={hasCapability(actor.role, CAPABILITIES.REPORT_EXPORT)}
                  currentUserName={user.name || user.email}
                />
              </div>
              <aside
                aria-label="Responder overview"
                data-testid="responder-rail"
                className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-1"
              >
                <MyQueueCard />
                <OnCallCard />
                <SlaRiskCard />
                <ActivityCard />
              </aside>
            </div>

            <ServicesAtRiskStrip />
            <DashboardHistorySection services={services} />
          </div>
        )}
      </LiveDashboardProvider>
    </DashboardHistoryProvider>
  );
}
