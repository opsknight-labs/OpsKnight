import { Suspense, cache } from 'react';
import { FreezeBanner } from '@/components/business-service/FreezeBanner';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Boxes, ExternalLink, Network, Pencil } from 'lucide-react';
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
import { orUnavailable } from '@/lib/business-services/dashboards';
import { FIRST_STEP_SELECT, onCallFor } from '@/lib/business-services/on-call';
import { computeErrorBudget } from '@/lib/business-services/slo';
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
import HealthUnavailable from '@/components/business-service/HealthUnavailable';
import ImpactTimeline from '@/components/business-service/ImpactTimeline';
import CustomerImpactPanel from '@/components/business-service/CustomerImpactPanel';
import { estimateDowntimeCostCents } from '@/lib/business-services/impact-cost';
import { listCustomerImpactReports } from '@/lib/business-services/customer-reports';
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
// Tab panels sit on a card, like the overview's sections, so muted text keeps AA contrast.
const TAB_CARD = 'rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5';
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

/** One 30-day stats read per render, shared by the KPI and incident-count sections. */
const stats30 = cache((id: string, actor: AuthorizationActor) =>
  getBusinessServiceStats(id, windowOf(30), actor)
);

const sloStats = (id: string, actor: AuthorizationActor, days: number) =>
  days === 30 ? stats30(id, actor) : getBusinessServiceStats(id, windowOf(days), actor);

/** Uptime and response KPIs (30 and 90 days). */
async function KpiSection({
  id,
  actor,
  slo,
}: {
  id: string;
  actor: AuthorizationActor;
  slo: { target: number; windowDays: number } | null;
}) {
  const stats = await orUnavailable(
    Promise.all([
      stats30(id, actor),
      getBusinessServiceStats(id, windowOf(90), actor),
      // The error budget is measured over the service's own SLO window.
      slo ? sloStats(id, actor, slo.windowDays) : null,
    ]),
    'business_services.overview.stats_unavailable'
  );
  if (!stats) {
    return <HealthUnavailable />;
  }
  const budget =
    slo && stats[2]
      ? {
          target: slo.target,
          windowDays: slo.windowDays,
          ...computeErrorBudget({
            targetPercent: slo.target,
            windowDays: slo.windowDays,
            downtimeMinutes: stats[2].weightedDowntimeMinutes ?? stats[2].impactMinutes,
          }),
        }
      : null;
  return <OverviewKpis last30={stats[0]} last90={stats[1]} slo={budget} />;
}

/** Cost of downtime, customers exposed and customer reports; for readers who may see incidents. */
async function CustomerImpactSection({
  item,
  actor,
  canAdd,
}: {
  item: {
    id: string;
    revenuePerHourCents: number | null;
    currency: string;
    customersTotal: number | null;
    customerReportThreshold: number | null;
    customerReportWindowMinutes: number | null;
  };
  actor: AuthorizationActor;
  canAdd: boolean;
}) {
  const data = await orUnavailable(
    Promise.all([stats30(item.id, actor), listCustomerImpactReports(item.id, actor, 5)]),
    'business_services.overview.customer_impact_unavailable'
  );
  return (
    <SectionCard
      id="bs-customer-impact"
      title="Customer impact"
      description="What downtime has cost, who is exposed, and what customers are reporting."
    >
      {data ? (
        <CustomerImpactPanel
          view={{
            businessServiceId: item.id,
            estimatedCostCents: estimateDowntimeCostCents(
              data[0].weightedDowntimeMinutes ?? 0,
              item.revenuePerHourCents
            ),
            currency: item.currency,
            customersTotal: item.customersTotal,
            windowDays: 30,
            threshold: item.customerReportThreshold,
            thresholdWindowMinutes: item.customerReportWindowMinutes,
            reports: data[1],
            canAdd,
          }}
        />
      ) : (
        <HealthUnavailable />
      )}
    </SectionCard>
  );
}

async function TimelineSection({
  id,
  actor,
  showIncidents,
  cost,
}: {
  id: string;
  actor: AuthorizationActor;
  showIncidents: boolean;
  cost?: { revenuePerHourCents: number | null; currency: string };
}) {
  const window = windowOf(30);
  const entries = await orUnavailable(
    getImpactTimeline(id, window, actor),
    'business_services.overview.timeline_unavailable'
  );
  return (
    <SectionCard
      id="bs-impact"
      title="Impact, last 30 days"
      description="When this business service was impacted, and how serious it was."
    >
      {entries ? (
        <ImpactTimeline entries={entries} window={window} showIncidents={showIncidents} cost={cost} />
      ) : (
        <HealthUnavailable />
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
  const stats = await orUnavailable(
    stats30(id, actor),
    'business_services.overview.stats_unavailable'
  );
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
      sloTarget: true,
      sloWindowDays: true,
      revenuePerHourCents: true,
      currency: true,
      customersTotal: true,
      customerReportThreshold: true,
      customerReportWindowMinutes: true,
      ownerUser: { select: { id: true, name: true, email: true } },
      escalationPolicy: {
        select: { id: true, name: true, steps: FIRST_STEP_SELECT },
      },
      contactChannel: true,
      tags: true,
      environment: true,
      lifecycle: true,
      lastReviewedAt: true,
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

  const health = await orUnavailable(
    getBusinessServiceHealth(
      [item.id, ...children.map(child => child.id), ...parents.map(parent => parent.id)],
      actor
    ),
    'business_services.overview.health_unavailable'
  );
  const own: BusinessServiceHealth | null = health?.get(item.id) ?? null;

  // Names for the "why" sentences: members and children are known; resolve the rest, in scope.
  const knownServices = new Map(item.members.map(m => [m.service.id, m.service.name]));
  const knownBusiness = new Map(children.map(child => [child.id, child.name]));
  const wanted = own ? reasonIds(own.reasons) : { services: [], businessServices: [] };
  const missingServices = wanted.services.filter(sid => !knownServices.has(sid));
  const missingBusiness = wanted.businessServices.filter(bid => !knownBusiness.has(bid));
  const [extraServices, extraBusiness, dependencies, onCall] = await Promise.all([
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
    onCallFor(item.escalationPolicy?.steps[0] ?? null, actor),
  ]);
  for (const row of extraServices) knownServices.set(row.id, row.name);
  for (const row of extraBusiness) knownBusiness.set(row.id, row.name);
  const reasons = own
    ? [
        ...(own.unknownReason === 'NO_MEMBERS'
          ? ['No member services yet, so health is unknown. Add services to monitor it.']
          : []),
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
      <Suspense fallback={null}>
        <FreezeBanner id={item.id} />
      </Suspense>
      <Suspense fallback={<KpiGridSkeleton count={4} />}>
        <KpiSection
          id={item.id}
          actor={actor}
          slo={
            item.sloTarget === null
              ? null
              : { target: item.sloTarget, windowDays: item.sloWindowDays }
          }
        />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Impact, last 30 days" height="h-24" />}>
        <TimelineSection
          id={item.id}
          actor={actor}
          showIncidents={canReadIncidents}
          cost={canReadIncidents ? item : undefined}
        />
      </Suspense>
      {canReadIncidents && (
        <Suspense fallback={<SectionSkeleton title="Customer impact" height="h-24" />}>
          <CustomerImpactSection item={item} actor={actor} canAdd={canManage} />
        </Suspense>
      )}
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
            <span className={pageHeaderBadgeClass}>Health unavailable</span>
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
            {!item.criticality && (
              <p className="text-xs text-status-elevated">
                Criticality is not set, so every open incident on a member counts as impact. Set a
                tier to filter out low-urgency noise.
              </p>
            )}
            {(item.tags.length > 0 || item.environment || item.lifecycle !== 'ACTIVE') && (
              <ul aria-label="Tags" className="flex flex-wrap gap-1.5 text-xs">
                {item.lifecycle !== 'ACTIVE' && (
                  <li className={pageHeaderBadgeClass}>{item.lifecycle}</li>
                )}
                {item.environment && <li className={pageHeaderBadgeClass}>{item.environment}</li>}
                {item.tags.map(tag => (
                  <li key={tag} className={pageHeaderBadgeClass}>
                    {tag}
                  </li>
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
          {
            label: 'Owner',
            value:
              item.ownerUser?.name ?? item.ownerUser?.email ?? item.ownerTeam?.name ?? 'No owner',
            subtext:
              item.ownerUser && item.ownerTeam
                ? item.ownerTeam.name
                : (item.contactChannel ?? undefined),
          },
          {
            label: 'On call now',
            value: onCall?.names.length ? onCall.names.join(', ') : '—',
            subtext: onCall?.names.length
              ? onCall.label
              : item.escalationPolicy
                ? item.escalationPolicy.name
                : 'No escalation policy',
          },
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
        secondaryActions={
          <>
            <Button
              asChild
              size="sm"
              variant="outline"
              className={cn('gap-1.5', pageHeaderActionClass)}
            >
              <Link href={`/services/graph?focus=bs:${item.id}`}>
                <Network className="h-4 w-4" aria-hidden />
                Show on graph
              </Link>
            </Button>
            {followButton}
          </>
        }
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

      {!health && (
        <HealthUnavailable message="Live status could not be loaded. Members, dependencies, status pages and followers below are current; refresh in a moment to try again." />
      )}

      <DetailTabs
        label="Business service sections"
        defaultTab={query?.tab}
        tabs={[
          { id: 'overview', label: 'Overview', content: overview },
          {
            id: 'members',
            label: 'Members',
            count: memberIds.length,
            content: (
              <div className={TAB_CARD}>
                <MembersPanel members={members} supporting={related(children)} />
              </div>
            ),
          },
          {
            id: 'dependencies',
            label: 'Dependencies',
            count: children.length + parents.length + technical.length,
            content: (
              <div className={TAB_CARD}>
                <DependenciesPanel
                  businessServiceId={item.id}
                  supporting={related(children)}
                  dependents={related(parents)}
                  technical={technical}
                />
              </div>
            ),
          },
          {
            id: 'status-pages',
            label: 'Status pages',
            count: item.statusPages.length,
            content: (
              <div className={TAB_CARD}>
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
              </div>
            ),
          },
          {
            id: 'followers',
            label: 'Followers',
            count: item._count.followers,
            content: (
              <div className={TAB_CARD}>
                <FollowersPanel
                  followers={item.followers.map(({ user }) => ({
                    id: user.id,
                    name: user.name ?? 'Unnamed user',
                  }))}
                  teams={item.teamSubscribers.map(({ team }) => team)}
                  dashboards={item.dashboards.map(({ dashboard }) => dashboard)}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
