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
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import AnalyticsRefreshButton from '@/components/analytics/AnalyticsRefreshButton';
import { BarChart3, Download } from 'lucide-react';

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
      {/* Centralized Hero Header */}
      <DetailHeroBanner
        tag="Incident Intelligence"
        title="Analytics & Insights"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-800/80 text-white border border-slate-700/80 shadow-xs">
            <BarChart3 className="h-6 w-6 text-rose-500" aria-hidden="true" />
          </div>
        }
        subtitle={
          <div className="space-y-2">
            <p className="text-xs text-slate-300 leading-relaxed">
              Incident health, SLA performance, and on-call readiness
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <span className="bg-slate-900/80 px-2.5 py-0.5 rounded-md border border-slate-800/90 text-[10px] font-medium text-slate-300">
                Coverage outlook
              </span>
              <span className="bg-slate-900/80 px-2.5 py-0.5 rounded-md border border-slate-800/90 text-[10px] font-medium text-slate-300">
                SLA compliance
              </span>
              <span className="bg-slate-900/80 px-2.5 py-0.5 rounded-md border border-slate-800/90 text-[10px] font-medium text-slate-300">
                Ownership load
              </span>
              <span className="bg-slate-900/80 px-2.5 py-0.5 rounded-md border border-slate-800/90 text-[10px] font-medium text-slate-300">
                Service health
              </span>
            </div>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800/90 text-slate-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Live Operations
              </span>
            </div>

            <AnalyticsRefreshButton />

            <a
              href={exportUrl}
              className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 text-slate-200 hover:text-white shadow-xs transition-all text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </a>
          </div>
        }
      />

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
