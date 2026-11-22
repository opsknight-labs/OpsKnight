import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Boxes, ExternalLink, Pencil } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requirePageAccess } from '@/lib/access/server';
import { CAPABILITIES } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  actorHasCapability,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import {
  getBusinessServiceHealth,
  getBusinessServiceStats,
  getImpactTimeline,
  type BusinessServiceHealth,
} from '@/lib/business-services/contract';
import { isEngineNotReady } from '@/lib/business-services/dashboards';
import { SectionCard, SectionSkeleton } from '@/components/analytics/SectionCard';
import { KpiGridSkeleton } from '@/components/analytics/KpiCard';
import { PageHeader } from '@/components/patterns';
import { pageHeaderActionClass, pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { Button } from '@/components/ui/shadcn/button';
import DetailTabs from '@/components/ui/DetailTabs';
import BusinessServiceFollowButton from '@/components/service/BusinessServiceFollowButton';
import HealthBadge, {
  CRITICALITY_HINT,
  CRITICALITY_LABEL,
} from '@/components/business-service/HealthBadge';
import HealthPreparing from '@/components/business-service/HealthPreparing';
import ImpactTimeline from '@/components/business-service/ImpactTimeline';
import {
  DependenciesPanel,
  FollowersPanel,
  MembersPanel,
  OverviewIncidentCounts,
  OverviewIncidents,
  OverviewKpis,
  StatusPagesPanel,
  type OverviewRelated,
} from '@/components/business-service/OverviewPanels';
import { describeReason, memberStatuses, reasonIds } from '@/components/business-service/reasons';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DAY = 86_400_000;
const windowOf = (days: number, to = new Date()) => ({
  from: new Date(to.getTime() - days * DAY),
  to,
});

/** Only http(s) links render; anything else in the JSON is dropped (no javascript: URLs). */
function safeLinks(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const { label, url } = entry as Record<string, unknown>;
    if (typeof url !== 'string') return [];
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [];
      return [{ label: typeof label === 'string' && label.trim() ? label : parsed.host, url }];
    } catch {
      return [];
    }
  });
}

/** Engine reads resolve to null while the engine is not live yet; other errors propagate. */
function unlessNotReady<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(error => {
    if (isEngineNotReady(error)) return null;
    throw error;
  });
}

/** Uptime and response KPIs (30 and 90 days). */
async function KpiSection({ id, actor }: { id: string; actor: AuthorizationActor }) {
  const now = new Date();
  const stats = await unlessNotReady(
    Promise.all([
      getBusinessServiceStats(id, windowOf(30, now), actor),
      getBusinessServiceStats(id, windowOf(90, now), actor),
    ])
  );
  if (!stats) {
    return (
      <HealthPreparing
        size="sm"
        description="Uptime, MTTA and MTTR appear once impact history is recorded."
      />
    );
  }
  return <OverviewKpis last30={stats[0]} last90={stats[1]} />;
}

async function TimelineSection({
  id,
  actor,
  showIncidents,
}: {
  id: string;
  actor: AuthorizationActor;
  showIncidents: boolean;
}) {
  const window = windowOf(30);
  const entries = await unlessNotReady(getImpactTimeline(id, window, actor));
  return (
    <SectionCard
      id="bs-impact"
      title="Impact, last 30 days"
      description="When this business service was impacted, and how serious it was."
    >
      {entries ? (
        <ImpactTimeline entries={entries} window={window} showIncidents={showIncidents} />
      ) : (
        <HealthPreparing
          size="sm"
          description="The impact timeline appears once impact history is recorded."
        />
      )}
    </SectionCard>
  );
}

/** Incidents the viewer may read, on member services or marked as impacting; active first. */
async function IncidentsSection({
  id,
  memberIds,
  actor,
}: {
  id: string;
  memberIds: string[];
  actor: AuthorizationActor;
}) {
  const since = windowOf(30).from;
  const rows = await prisma.incident.findMany({
    where: {
      AND: [
        incidentReadWhere(actor),
        {
          OR: [
            { serviceId: { in: memberIds } },
            { businessServiceImpacts: { some: { businessServiceId: id, excluded: false } } },
          ],
        },
        { OR: [{ status: { not: 'RESOLVED' } }, { createdAt: { gte: since } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      status: true,
      urgency: true,
      createdAt: true,
      resolvedAt: true,
      service: { select: { name: true } },
    },
  });
  const incidents = rows
    .map(row => ({ ...row, serviceName: row.service.name }))
    .sort((a, b) => Number(a.status === 'RESOLVED') - Number(b.status === 'RESOLVED'));
  return (
    <SectionCard
      id="bs-incidents"
      title="Active and recent incidents"
      description="Open incidents first, then the last 30 days."
      flush
    >
      <OverviewIncidents incidents={incidents} />
    </SectionCard>
  );
}

async function IncidentCountSection({
  id,
  actor,
  open,
}: {
  id: string;
  actor: AuthorizationActor;
  open: number;
}) {
  const stats = await unlessNotReady(getBusinessServiceStats(id, windowOf(30), actor));
  const last30 = stats?.incidentCount ?? null;
  return (
    <SectionCard id="bs-incidents" title="Incidents">
      <OverviewIncidentCounts open={open} last30={last30} />
    </SectionCard>
  );
}

/**
 * Read-only business-service overview: hero (health, since, why, owner, criticality, links, follow,
 * edit) and tabs for overview, members, dependencies, status pages and followers. Open to every service
 * reader; stakeholders get counts instead of incident details.
 */
export default async function BusinessServiceOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requirePageAccess('/services/business/[id]');
  const [{ id }, query, actor] = await Promise.all([
    params,
    searchParams,
    getCurrentAuthorizationActor(),
  ]);
  const readWhere = businessServiceReadWhere(actor);
  const item = await prisma.businessService.findFirst({
    where: { AND: [{ id }, readWhere] },
    select: {
      id: true,
      name: true,
      description: true,
      criticality: true,
      links: true,
      ownerTeam: { select: { id: true, name: true } },
      members: {
        orderBy: { createdAt: 'asc' },
        select: {
          critical: true,
          service: {
            select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
          },
        },
      },
      supportedBy: {
        where: { child: readWhere },
        select: { child: { select: { id: true, name: true, criticality: true } } },
      },
      supports: {
        where: { parent: readWhere },
        select: { parent: { select: { id: true, name: true, criticality: true } } },
      },
      statusPages: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          displayName: true,
          showOnPage: true,
          showMembers: true,
          statusOverride: true,
          statusOverrideUntil: true,
          statusPage: {
            select: {
              id: true,
              name: true,
              slug: true,
              isDefault: true,
              enabled: true,
              serviceLayout: true,
            },
          },
        },
      },
      followers: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { user: { select: { id: true, name: true } } },
      },
      teamSubscribers: { select: { team: { select: { id: true, name: true } } } },
      dashboards: { select: { dashboard: { select: { name: true, slug: true } } } },
      _count: { select: { followers: true } },
    },
  });
  if (!item) notFound();

  const canManage = actorHasCapability(actor, CAPABILITIES.OPERATIONS_MANAGE);
  const canReadIncidents = authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  }).allowed;
  const serviceRead = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
  const allServices = serviceRead.allowed && serviceRead.scope === 'global';
  const memberIds = item.members.map(member => member.service.id);
  const children = item.supportedBy.map(link => link.child);
  const parents = item.supports.map(link => link.parent);

  const health = await unlessNotReady(
    getBusinessServiceHealth(
      [item.id, ...children.map(child => child.id), ...parents.map(parent => parent.id)],
      actor
    )
  );
  const own: BusinessServiceHealth | null = health?.get(item.id) ?? null;

  // Names for the "why" sentences: members and children are known; resolve the rest, in scope.
  const knownServices = new Map(item.members.map(m => [m.service.id, m.service.name]));
  const knownBusiness = new Map(children.map(child => [child.id, child.name]));
  const wanted = own ? reasonIds(own.reasons) : { services: [], businessServices: [] };
  const missingServices = wanted.services.filter(sid => !knownServices.has(sid));
  const missingBusiness = wanted.businessServices.filter(bid => !knownBusiness.has(bid));
  const [extraServices, extraBusiness, dependencies] = await Promise.all([
    missingServices.length
      ? prisma.service.findMany({
          where: { AND: [{ id: { in: missingServices } }, serviceReadWhere(actor)] },
          select: { id: true, name: true },
        })
      : [],
    missingBusiness.length
      ? prisma.businessService.findMany({
          where: { AND: [{ id: { in: missingBusiness } }, readWhere] },
          select: { id: true, name: true },
        })
      : [],
    memberIds.length
      ? prisma.serviceDependency.findMany({
          where: {
            status: 'ACTIVE',
            downstreamServiceId: { in: memberIds },
            upstreamServiceId: { notIn: memberIds },
            upstream: serviceReadWhere(actor),
          },
          take: 200,
          select: {
            upstream: { select: { id: true, name: true } },
            downstream: { select: { name: true } },
          },
        })
      : [],
  ]);
  for (const row of extraServices) knownServices.set(row.id, row.name);
  for (const row of extraBusiness) knownBusiness.set(row.id, row.name);
  const reasons = own
    ? [
        ...new Set(
          own.reasons.map(reason =>
            describeReason(reason, { services: knownServices, businessServices: knownBusiness })
          )
        ),
      ]
    : [];

  const technical = [
    ...dependencies
      .reduce((byId, edge) => {
        const entry = byId.get(edge.upstream.id) ?? { ...edge.upstream, usedBy: [] as string[] };
        if (!entry.usedBy.includes(edge.downstream.name)) entry.usedBy.push(edge.downstream.name);
        return byId.set(edge.upstream.id, entry);
      }, new Map<string, { id: string; name: string; usedBy: string[] }>())
      .values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const statusOf = new Map(own ? memberStatuses(own.reasons) : []);
  const members = item.members.map(({ critical, service }) => ({
    id: service.id,
    name: service.name,
    critical,
    teamName: service.team?.name ?? null,
    canOpen: allServices || (service.teamId !== null && actor.teamIds.includes(service.teamId)),
    status: own ? (statusOf.get(service.id) ?? 'OPERATIONAL') : null,
  }));
  const related = (rows: typeof children): OverviewRelated[] =>
    rows.map(row => ({ ...row, status: health?.get(row.id)?.status ?? null }));
  const following = item.followers.some(follower => follower.user.id === actor.id);
  const links = safeLinks(item.links);

  const followButton = (
    <BusinessServiceFollowButton
      id={item.id}
      name={item.name}
      following={following}
      className={pageHeaderActionClass}
    />
  );

  const overview = (
    <div className="space-y-4 sm:space-y-6">
      <Suspense fallback={<KpiGridSkeleton count={4} />}>
        <KpiSection id={item.id} actor={actor} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Impact, last 30 days" height="h-24" />}>
        <TimelineSection id={item.id} actor={actor} showIncidents={canReadIncidents} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Incidents" height="h-40" />}>
        {canReadIncidents ? (
          <IncidentsSection id={item.id} memberIds={memberIds} actor={actor} />
        ) : (
          <IncidentCountSection id={item.id} actor={actor} open={own?.openIncidentCount ?? 0} />
        )}
      </Suspense>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        eyebrow="Business Service"
        title={item.name}
        icon={Boxes}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          { label: 'Business services', href: '/services/business' },
          { label: item.name },
        ]}
        badges={
          own ? (
            <HealthBadge status={own.status} since={own.since} variant="solid" />
          ) : (
            <span className={pageHeaderBadgeClass}>Health pending</span>
          )
        }
        description={
          <div className="space-y-2">
            {item.description && <p>{item.description}</p>}
            {reasons.length > 0 && (
              <ul
                aria-label="Why it has this status"
                className="list-disc space-y-0.5 pl-4 text-xs"
              >
                {reasons.map(reason => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            {links.length > 0 && (
              <ul aria-label="Links" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {links.map(entry => (
                  <li key={entry.url}>
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {entry.label}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
        stats={[
          { label: 'Owner team', value: item.ownerTeam?.name ?? 'No owner' },
          {
            label: 'Criticality',
            value: item.criticality ? CRITICALITY_LABEL[item.criticality] : 'Not set',
            subtext: item.criticality ? CRITICALITY_HINT[item.criticality] : undefined,
          },
          {
            label: 'Services',
            value: memberIds.length.toLocaleString(),
            subtext: own?.impactedMemberCount ? `${own.impactedMemberCount} impacted` : undefined,
          },
          {
            label: 'Open incidents',
            value: own ? own.openIncidentCount.toLocaleString() : '—',
          },
          { label: 'Followers', value: item._count.followers.toLocaleString() },
        ]}
        secondaryActions={followButton}
        primaryAction={
          canManage ? (
            <Button asChild size="sm" className={cn('gap-1.5', pageHeaderActionClass)}>
              <Link href={`/services/business/${item.id}/edit`}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
            </Button>
          ) : undefined
        }
      />

      {!own && <HealthPreparing size="sm" />}

      <DetailTabs
        label="Business service sections"
        defaultTab={query?.tab}
        tabs={[
          { id: 'overview', label: 'Overview', content: overview },
          {
            id: 'members',
            label: 'Members',
            count: memberIds.length,
            content: <MembersPanel members={members} supporting={related(children)} />,
          },
          {
            id: 'dependencies',
            label: 'Dependencies',
            count: children.length + parents.length + technical.length,
            content: (
              <DependenciesPanel
                businessServiceId={item.id}
                supporting={related(children)}
                dependents={related(parents)}
                technical={technical}
              />
            ),
          },
          {
            id: 'status-pages',
            label: 'Status pages',
            count: item.statusPages.length,
            content: (
              <StatusPagesPanel
                canManage={canManage}
                pages={item.statusPages.map(link => ({
                  id: link.id,
                  pageId: link.statusPage.id,
                  name: link.statusPage.name,
                  href: link.statusPage.enabled
                    ? link.statusPage.isDefault || !link.statusPage.slug
                      ? '/status'
                      : `/status/${link.statusPage.slug}`
                    : null,
                  displayName: link.displayName,
                  showOnPage: link.showOnPage,
                  showMembers: link.showMembers,
                  grouped: link.statusPage.serviceLayout !== 'FLAT',
                  override:
                    link.statusOverride &&
                    (!link.statusOverrideUntil || link.statusOverrideUntil > new Date())
                      ? (link.statusOverride as BusinessServiceHealth['status'])
                      : null,
                  overrideUntil: link.statusOverrideUntil,
                }))}
              />
            ),
          },
          {
            id: 'followers',
            label: 'Followers',
            count: item._count.followers,
            content: (
              <FollowersPanel
                followers={item.followers.map(({ user }) => ({
                  id: user.id,
                  name: user.name ?? 'Unnamed user',
                }))}
                teams={item.teamSubscribers.map(({ team }) => team)}
                dashboards={item.dashboards.map(({ dashboard }) => dashboard)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
