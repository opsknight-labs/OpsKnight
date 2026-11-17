import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getUserTimeZone } from '@/lib/timezone';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import AnalyticsFilters from '@/components/analytics/AnalyticsFilters';
import AnalyticsContent from '@/components/analytics/AnalyticsContent';
import AnalyticsSkeleton from '@/components/analytics/AnalyticsSkeleton';
import { buildAnalyticsExportUrl } from '@/lib/analytics-export';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  dashboardUserReadWhere,
  serviceReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
import { PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { Button } from '@/components/ui/shadcn/button';
import AnalyticsRefreshButton from '@/components/analytics/AnalyticsRefreshButton';
import { BarChart3, Download } from 'lucide-react';
import { resolveAccessContext } from '@/lib/access-context';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';

import './analytics-v2.css';
import { requirePageAccess } from '@/lib/access/server';

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
  await requirePageAccess('/analytics');
  const session = await getServerSession(await getAuthOptions());
  const actor = await getCurrentAuthorizationActor();
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { timeZone: true } })
    : null;
  const userTimeZone = getUserTimeZone(user ?? undefined);
  const accessContext = await resolveAccessContext(actor);

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
    <div className="analytics-v2 mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 pb-16 md:px-6 md:py-8 sm:pb-20">
      <PageHeader
        title="Analytics & Insights"
        icon={BarChart3}
        description="Incident volume, SLA performance, ownership load and on-call readiness for the selected window."
        secondaryActions={<AnalyticsRefreshButton />}
        primaryAction={
          hasCapability(actor.role, CAPABILITIES.REPORT_EXPORT) ? (
            <Button asChild variant="outline" size="sm" className={pageHeaderActionClass}>
              <a href={exportUrl}>
                <Download aria-hidden="true" />
                Export
              </a>
            </Button>
          ) : undefined
        }
      />

      {accessContext.mode !== 'GLOBAL' && (
        <div
          role="note"
          className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
        >
          <strong className="font-semibold text-foreground">
            {accessContext.mode === 'NONE'
              ? 'No data in your access scope'
              : 'Analytics — your scope'}
          </strong>
          <span className="ml-2">
            {accessContext.mode === 'NONE'
              ? 'Ask an administrator to assign a team or operational resource.'
              : `Based on ${accessContext.serviceCount} accessible service${accessContext.serviceCount === 1 ? '' : 's'}.`}
          </span>
        </div>
      )}

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

      {/* The dense metric panels were designed at 80% scale; the header and filters stay at
          the console's normal size so they match every other page. */}
      <div className="[zoom:0.8] space-y-6">
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
    </div>
  );
}
