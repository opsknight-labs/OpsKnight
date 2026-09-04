import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getUserTimeZone } from '@/lib/timezone';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import AnalyticsFilters from '@/components/analytics/AnalyticsFilters';
import FilterChips from '@/components/analytics/FilterChips';
import AnalyticsContent from '@/components/analytics/AnalyticsContent';
import AnalyticsSkeleton from '@/components/analytics/AnalyticsSkeleton';
import { buildAnalyticsExportUrl } from '@/lib/analytics-export';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  dashboardUserReadWhere,
  serviceReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
import { LayoutDashboard, BarChart3, Repeat } from 'lucide-react';

import './analytics-v2.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Analytics V2 | OpsKnight',
  description: 'Incident Operations Analytics',
};

const allowedStatus = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED', 'RESOLVED'] as const;
const allowedUrgency = ['HIGH', 'MEDIUM', 'LOW'] as const;
const allowedWindows = new Set([1, 3, 7, 14, 30, 60, 90, 180, 365]);

type SearchParams = {
  service?: string;
  team?: string;
  assignee?: string;
  status?: string;
  urgency?: string;
  window?: string;
};

export default async function AnalyticsV2Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerSession(await getAuthOptions());
  const actor = await getCurrentAuthorizationActor();
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { timeZone: true } })
    : null;
  const userTimeZone = getUserTimeZone(user ?? undefined);

  const params = await searchParams;
  const teamId =
    typeof params?.team === 'string' && params.team !== 'ALL' ? params.team : undefined;
  const serviceId =
    typeof params?.service === 'string' && params.service !== 'ALL' ? params.service : undefined;
  const assigneeId =
    typeof params?.assignee === 'string' && params.assignee !== 'ALL' ? params.assignee : undefined;
  const statusFilter =
    typeof params?.status === 'string' &&
    allowedStatus.includes(params.status as (typeof allowedStatus)[number])
      ? (params.status as (typeof allowedStatus)[number])
      : undefined;
  const urgencyFilter =
    typeof params?.urgency === 'string' &&
    allowedUrgency.includes(params.urgency as (typeof allowedUrgency)[number])
      ? (params.urgency as (typeof allowedUrgency)[number])
      : undefined;
  const windowCandidate = Number(params?.window ?? 7);
  const windowDays = allowedWindows.has(windowCandidate) ? windowCandidate : 7;

  const [teams, services, users] = await Promise.all([
    prisma.team.findMany({ where: teamReadWhere(actor), select: { id: true, name: true } }),
    prisma.service.findMany({
      where: serviceReadWhere(actor),
      select: { id: true, name: true, teamId: true },
    }),
    prisma.user.findMany({
      where: dashboardUserReadWhere(actor),
      select: { id: true, name: true, email: true },
    }),
  ]);

  const servicesForFilter = teamId ? services.filter(s => s.teamId === teamId) : services;
  const effectiveServiceId = servicesForFilter.some(service => service.id === serviceId)
    ? serviceId
    : undefined;

  const exportUrl = buildAnalyticsExportUrl({
    windowDays,
    teamId,
    serviceId: effectiveServiceId,
    assigneeId,
    status: statusFilter,
    urgency: urgencyFilter,
  });

  // suspenseKey forces React to show the skeleton again whenever filters
  // change, so users see an immediate structural placeholder during the
  // re-query instead of stale content frozen on screen.
  const suspenseKey = [
    teamId ?? 'ALL',
    effectiveServiceId ?? 'ALL',
    assigneeId ?? 'ALL',
    statusFilter ?? 'ALL',
    urgencyFilter ?? 'ALL',
    windowDays,
  ].join('|');

  return (
    <div className="w-full px-4 py-6 space-y-6 [zoom:0.8] pb-16 sm:pb-20 analytics-v2">
      {/* Header with Stats — renders instantly, no DB dependency */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white rounded-lg p-4 md:p-6 shadow-lg mb-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight flex items-center gap-4 text-white">
              <LayoutDashboard className="h-10 w-10 md:h-12 md:w-12" />
              Analytics & Insights
            </h1>
            <p className="text-xs md:text-sm opacity-90 mt-1 text-white">
              Incident health, SLA performance, and on-call readiness
            </p>
            <div className="flex flex-wrap gap-2 mt-2 text-[10px] md:text-xs uppercase tracking-wider text-white/80 font-medium">
              <span className="bg-white/10 px-2 py-0.5 rounded-full border border-white/20">
                Coverage outlook
              </span>
              <span className="bg-white/10 px-2 py-0.5 rounded-full border border-white/20">
                SLA compliance
              </span>
              <span className="bg-white/10 px-2 py-0.5 rounded-full border border-white/20">
                Ownership load
              </span>
              <span className="bg-white/10 px-2 py-0.5 rounded-full border border-white/20">
                Service health
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4 lg:mt-0">
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg border border-white/20 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide">Live Operations</span>
            </div>

            <button
              className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-sm transition-all text-xs font-semibold"
              type="button"
            >
              <Repeat className="w-3.5 h-3.5" />
              Refresh
            </button>

            <a
              href={exportUrl}
              className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-white text-primary hover:bg-gray-50 shadow-sm transition-all text-xs font-bold"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Export
            </a>
          </div>
        </div>
      </div>

      {/* Filter bar — fast queries, renders before heavy metrics */}
      <AnalyticsFilters
        teams={teams}
        services={servicesForFilter}
        users={users}
        currentFilters={{
          team: teamId ?? 'ALL',
          service: effectiveServiceId ?? 'ALL',
          assignee: assigneeId ?? 'ALL',
          status: statusFilter ?? 'ALL',
          urgency: urgencyFilter ?? 'ALL',
          window: `${windowDays}`,
        }}
      />

      <div className="analytics-context analytics-context-compact">
        <FilterChips
          filters={{
            team: teamId ?? 'ALL',
            service: effectiveServiceId ?? 'ALL',
            assignee: assigneeId ?? 'ALL',
            status: statusFilter ?? 'ALL',
            urgency: urgencyFilter ?? 'ALL',
          }}
          teams={teams}
          services={servicesForFilter}
          users={users}
        />
      </div>

      {/* Heavy metrics stream in via Suspense. The key changes when filters
          change, which forces React to show the skeleton fallback again
          while the new data loads — much smoother than freezing on stale
          numbers or popping to a blank page. */}
      <Suspense key={suspenseKey} fallback={<AnalyticsSkeleton />}>
        <AnalyticsContent
          teamId={teamId}
          actor={actor}
          serviceId={effectiveServiceId}
          assigneeId={assigneeId}
          statusFilter={statusFilter}
          urgencyFilter={urgencyFilter}
          windowDays={windowDays}
          userTimeZone={userTimeZone}
        />
      </Suspense>
    </div>
  );
}
