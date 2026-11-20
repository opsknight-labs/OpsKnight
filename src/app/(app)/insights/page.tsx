import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { BarChart3, Download } from 'lucide-react';
import AnalyticsAsk from '@/components/analytics/AnalyticsAsk';
import AnalyticsFilters from '@/components/analytics/AnalyticsFilters';
import AnalyticsFreshness from '@/components/analytics/AnalyticsFreshness';
import AnalyticsViews from '@/components/analytics/AnalyticsViews';
import { AvailabilitySection } from '@/components/analytics/AvailabilitySection';
import { BreakdownSection } from '@/components/analytics/BreakdownSection';
import { SectionSkeleton } from '@/components/analytics/SectionCard';
import {
  FollowThroughSection,
  KpiSection,
  NoiseSection,
  RespondersSection,
  ServicesSection,
  TimingSection,
  TrendSection,
} from '@/components/analytics/sections';
import { PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { requirePageAccess } from '@/lib/access/server';
import { resolveAccessContext } from '@/lib/access-context';
import {
  analyticsParamsKey,
  createAnalyticsContext,
  parseAnalyticsParams,
  toAnalyticsSearchParams,
} from '@/lib/analytics';
import { getDefaultAnalyticsViewQuery, listAnalyticsViews } from '@/lib/analytics/views';
import { getAuthOptions } from '@/lib/auth';
import { opsHelpersOn } from '@/lib/intelligence/helpers/on-demand';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  dashboardUserReadWhere,
  serviceReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { formatDateKeyInTimeZone, getUserTimeZone } from '@/lib/timezone';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Analytics | OpsKnight',
  description:
    'Incident volume, response times, SLA, responder load and noise across your services.',
};

// Bounded option lists; the comboboxes search within them.
const OPTION_LIMIT = 500;
const PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5'];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageAccess('/insights');
  const [actor, session, raw] = await Promise.all([
    getCurrentAuthorizationActor(),
    getAuthOptions().then(options => getServerSession(options)),
    searchParams,
  ]);
  if (Object.keys(raw ?? {}).length === 0) {
    const defaultQuery = await getDefaultAnalyticsViewQuery(actor.id);
    if (defaultQuery) redirect(`/insights?${defaultQuery}`);
  }
  const params = parseAnalyticsParams(raw);
  const email = session?.user?.email ?? null;

  const [user, accessContext, teams, services, users, views, helpersOn] = await Promise.all([
    email ? prisma.user.findUnique({ where: { email }, select: { timeZone: true } }) : null,
    resolveAccessContext(actor),
    prisma.team.findMany({
      where: teamReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: OPTION_LIMIT,
    }),
    prisma.service.findMany({
      where: {
        AND: [serviceReadWhere(actor), params.teams.length ? { teamId: { in: params.teams } } : {}],
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: OPTION_LIMIT,
    }),
    prisma.user.findMany({
      where: dashboardUserReadWhere(actor),
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      take: OPTION_LIMIT,
    }),
    listAnalyticsViews(actor),
    // The plain-words box sits behind the small-helpers switch (off by default).
    opsHelpersOn().catch(() => false),
  ]);

  const context = await createAnalyticsContext(actor, params, getUserTimeZone(user ?? undefined));
  const key = analyticsParamsKey(params);
  const exportQuery = toAnalyticsSearchParams(params).toString();
  const canExport = hasCapability(actor.role, CAPABILITIES.REPORT_EXPORT);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        eyebrow="Reliability insights"
        title="Analytics"
        description="How your services and responders are performing, and where to improve."
        icon={BarChart3}
        primaryAction={
          canExport ? (
            <a
              href={`/api/insights/export${exportQuery ? `?${exportQuery}` : ''}`}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                pageHeaderActionClass
              )}
            >
              <Download className="h-4 w-4" aria-hidden />
              Export CSV
            </a>
          ) : undefined
        }
      />

      {helpersOn && <AnalyticsAsk />}

      <AnalyticsFilters
        teams={teams}
        services={services}
        users={users.map(u => ({ id: u.id, name: u.name || u.email }))}
        priorities={PRIORITIES}
        actions={
          <AnalyticsViews views={views} teams={teams.filter(t => actor.teamIds.includes(t.id))} />
        }
      />
      <Suspense key={`fresh-${key}`} fallback={<div className="h-11 sm:h-5" aria-hidden />}>
        <AnalyticsFreshness context={context} />
      </Suspense>

      {accessContext.mode !== 'GLOBAL' && (
        <InlineNotice tone={accessContext.mode === 'NONE' ? 'warning' : 'info'}>
          {accessContext.mode === 'NONE'
            ? 'Nothing is in your access scope yet. Ask an administrator to add you to a team.'
            : `You see incidents from ${accessContext.serviceCount} service${accessContext.serviceCount === 1 ? '' : 's'} you can access, plus incidents assigned to you or that you watch.`}
        </InlineNotice>
      )}
      {context.window.isClipped && (
        <InlineNotice tone="info">
          The range starts at{' '}
          {formatDateKeyInTimeZone(context.window.start, context.window.timeZone)} because older
          incident data is past the retention period.
        </InlineNotice>
      )}

      {/* Each section streams on its own; keyed so a filter change shows fresh skeletons. */}
      <Suspense key={`kpis-${key}`} fallback={<KpiSkeleton />}>
        <KpiSection context={context} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-12">
        <Suspense
          key={`trend-${key}`}
          fallback={
            <>
              <SectionSkeleton title="incident volume" className="xl:col-span-12" />
              <SectionSkeleton title="time to acknowledge" className="xl:col-span-6" />
              <SectionSkeleton title="time to resolve" className="xl:col-span-6" />
            </>
          }
        >
          <TrendSection context={context} />
        </Suspense>
        <Suspense
          key={`services-${key}`}
          fallback={<SectionSkeleton title="services" className="xl:col-span-12" />}
        >
          <ServicesSection context={context} />
        </Suspense>
        <Suspense
          key={`breakdown-${key}`}
          fallback={<SectionSkeleton title="breakdown" className="xl:col-span-12" />}
        >
          <BreakdownSection context={context} />
        </Suspense>
        <Suspense
          key={`availability-${key}`}
          fallback={<SectionSkeleton title="availability" className="xl:col-span-12" />}
        >
          <AvailabilitySection context={context} />
        </Suspense>
        <Suspense
          key={`responders-${key}`}
          fallback={<SectionSkeleton title="responder load" className="xl:col-span-7" />}
        >
          <RespondersSection context={context} />
        </Suspense>
        <Suspense
          key={`timing-${key}`}
          fallback={<SectionSkeleton title="incident timing" className="xl:col-span-5" />}
        >
          <TimingSection context={context} />
        </Suspense>
        <Suspense
          key={`noise-${key}`}
          fallback={<SectionSkeleton title="noise" className="xl:col-span-7" />}
        >
          <NoiseSection context={context} />
        </Suspense>
        <Suspense
          key={`follow-${key}`}
          fallback={
            <SectionSkeleton title="follow-through" height="h-40" className="xl:col-span-5" />
          }
        >
          <FollowThroughSection context={context} />
        </Suspense>
      </div>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <ul
      role="status"
      aria-label="Loading key metrics"
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index} className="h-[6.5rem] animate-pulse rounded-lg border bg-card shadow-sm" />
      ))}
    </ul>
  );
}
