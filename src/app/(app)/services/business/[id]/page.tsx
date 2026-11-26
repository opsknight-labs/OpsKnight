import { Suspense, cache, type ReactNode } from 'react';
import { FreezeBanner } from '@/components/business-service/FreezeBanner';
import AutoRefresh from '@/components/business-service/AutoRefresh';
import WhyStatusCard, { type WhyReason } from '@/components/business-service/WhyStatusCard';
import DependencyHealthSummary from '@/components/business-service/DependencyHealthSummary';
import ActivityPanel from '@/components/business-service/ActivityPanel';
import ChangesSection from '@/components/business-service/ChangesPanel';
import SlaReportMenu from '@/components/business-service/SlaReportMenu';
import AddMembersDialog from '@/components/business-service/AddMembersDialog';
import CopyLinkButton from '@/components/business-service/CopyLinkButton';
import DetailsPanel from '@/components/business-service/DetailsPanel';
import { dailyImpactMinutes } from '@/components/business-service/impact-days';
import InlineNotice from '@/components/ui/InlineNotice';
import { auditReferenceIds } from '@/lib/business-services/audit-diff';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Boxes, Network, Pencil } from 'lucide-react';
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
import { getErrorBudgets } from '@/lib/business-services/stats';
import { contactChannelHref } from '@/lib/business-services/chat-channels';
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
  LIFECYCLE_LABEL,
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
const BUDGET_STATE = { OK: 'on track', AT_RISK: 'at risk', BREACHED: 'spent' } as const;
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

/** One 30-day stats read per render, shared by the KPI, customer-impact and incident-count sections. */
const stats30 = cache((id: string, actor: AuthorizationActor) =>
  getBusinessServiceStats(id, windowOf(30), actor)
);

/** The 30 days before the last 30, for the KPI deltas. */
const previous30 = (id: string, actor: AuthorizationActor) =>
  getBusinessServiceStats(id, windowOf(30, new Date(Date.now() - 30 * DAY)), actor);

/** The error budget over the service's own SLO window; shared by the header stat and the KPIs. */
const budgetOf = cache(async (id: string) => (await getErrorBudgets([id])).get(id) ?? null);

/** One timeline read per window per render, shared by the sparkline and the impact chart. */
const timelineOf = cache(async (id: string, actor: AuthorizationActor, days: number) => {
  const window = windowOf(days);
  return { window, entries: await getImpactTimeline(id, window, actor) };
});

const IMPACT_WINDOWS = [7, 30, 90] as const;

/** Uptime and response KPIs (30 and 90 days) with deltas against the 30 days before. */
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
      previous30(id, actor),
      slo ? budgetOf(id) : null,
      timelineOf(id, actor, 30),
    ]),
    'business_services.overview.stats_unavailable'
  );
  if (!stats) {
    return <HealthUnavailable />;
  }
  const [last30, last90, previous, budget, timeline] = stats;
  return (
    <OverviewKpis
      last30={last30}
      last90={last90}
      previous={previous}
      daily={dailyImpactMinutes(timeline.entries, timeline.window)}
      slo={slo && budget ? { target: slo.target, windowDays: slo.windowDays, ...budget } : null}
    />
  );
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
            viewerId: actor.id,
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
  days,
  showIncidents,
  cost,
  canUnmark,
}: {
  id: string;
  actor: AuthorizationActor;
  days: number;
  showIncidents: boolean;
  cost?: { revenuePerHourCents: number | null; currency: string };
  canUnmark: boolean;
}) {
  const timeline = await orUnavailable(
    timelineOf(id, actor, days),
    'business_services.overview.timeline_unavailable'
  );
  return (
    <SectionCard
      id="bs-impact"
      title={`Impact, last ${days} days`}
      description="When this business service was impacted, and how serious it was."
    >
      {timeline ? (
        <ImpactTimeline
          entries={timeline.entries}
          window={timeline.window}
          showIncidents={showIncidents}
          cost={cost}
          businessServiceId={id}
          canUnmark={canUnmark}
          ranges={IMPACT_WINDOWS.map(option => ({
            days: option,
            href:
              option === 30
                ? `/services/business/${id}#bs-impact`
                : `/services/business/${id}?impact=${option}#bs-impact`,
            current: option === days,
          }))}
        />
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

/** Status pages tab: loaded only when the tab is open. */
async function StatusPagesSection({ id, canManage }: { id: string; canManage: boolean }) {
  const pages = await prisma.statusPageBusinessService.findMany({
    where: { businessServiceId: id },
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
  });
  return (
    <div className={TAB_CARD}>
      <StatusPagesPanel
        canManage={canManage}
        pages={pages.map(link => ({
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
  );
}

/** Followers tab: loaded only when the tab is open. */
async function FollowersSection({ id, followAction }: { id: string; followAction: ReactNode }) {
  const [followers, teams, dashboards] = await Promise.all([
    prisma.businessServiceFollower.findMany({
      where: { businessServiceId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.businessServiceTeamSubscriber.findMany({
      where: { businessServiceId: id },
      select: { team: { select: { id: true, name: true } } },
    }),
    prisma.statusDashboardBusinessService.findMany({
      where: { businessServiceId: id },
      select: { dashboard: { select: { name: true, slug: true } } },
    }),
  ]);
  return (
    <div className={TAB_CARD}>
      <FollowersPanel
        followers={followers.map(({ user }) => ({
          id: user.id,
          name: user.name ?? 'Unnamed user',
        }))}
        teams={teams.map(({ team }) => team)}
        dashboards={dashboards.map(({ dashboard }) => dashboard)}
        followAction={followAction}
      />
    </div>
  );
}

/** Activity tab: the BUSINESS_SERVICE audit trail of this service, newest first, with before and after. */
const ACTIVITY_PAGE = 50;
const ACTIVITY_MAX = 500;

async function ActivitySection({ id, limit }: { id: string; limit: number }) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'BUSINESS_SERVICE', entityId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: { id: true, action: true, actorName: true, createdAt: true, details: true },
  });
  const ids = [...new Set(rows.flatMap(row => auditReferenceIds(row.details)))];
  const [teams, users] = ids.length
    ? await Promise.all([
        prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true },
        }),
      ])
    : [[], []];
  const names = new Map<string, string>([
    ...teams.map(team => [team.id, team.name] as const),
    ...users.map(user => [user.id, user.name ?? user.email] as const),
  ]);
  return (
    <div className={TAB_CARD}>
      <ActivityPanel
        entries={rows}
        names={names}
        moreHref={
          rows.length === limit && limit < ACTIVITY_MAX
            ? `/services/business/${id}?tab=activity&activity=${limit + ACTIVITY_PAGE}`
            : undefined
        }
      />
    </div>
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
  searchParams?: Promise<{ tab?: string; impact?: string; activity?: string }>;
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
      customAttributes: true,
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
      _count: { select: { followers: true, statusPages: true } },
    },
  });
  if (!item) notFound();

  const canReadAudit = actorHasCapability(actor, CAPABILITIES.AUDIT_READ);
  // Only tabs this viewer is offered: ?tab=activity without audit access falls back to the overview.
  const tabIds = [
    'overview',
    'members',
    'dependencies',
    'status-pages',
    'followers',
    'changes',
    ...(canReadAudit ? ['activity'] : []),
  ];
  const tab = query?.tab && tabIds.includes(query.tab) ? query.tab : 'overview';
  const impactDays = IMPACT_WINDOWS.find(days => String(days) === query?.impact) ?? (30 as number);
  const activityLimit = Math.min(
    Math.max(Math.trunc(Number(query?.activity) || ACTIVITY_PAGE), ACTIVITY_PAGE),
    ACTIVITY_MAX
  );

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
  // Reason names and their incidents only feed the overview's "why" card: other tabs skip them.
  const wanted =
    own && tab === 'overview' ? reasonIds(own.reasons) : { services: [], businessServices: [] };
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
  // Open incidents behind DIRECT and DEPENDENCY reasons, so each reason can link to one (readers of incidents only).
  const reasonServiceIds =
    own && tab === 'overview'
      ? [
          ...new Set(
            own.reasons.flatMap(reason =>
              reason.kind === 'DIRECT' || reason.kind === 'DEPENDENCY' ? [reason.serviceId] : []
            )
          ),
        ]
      : [];
  const openByService = new Map<string, string>();
  if (canReadIncidents && reasonServiceIds.length) {
    const open = await prisma.incident.findMany({
      where: {
        AND: [
          incidentReadWhere(actor),
          { serviceId: { in: reasonServiceIds }, status: { not: 'RESOLVED' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, serviceId: true },
    });
    for (const row of open)
      if (!openByService.has(row.serviceId)) openByService.set(row.serviceId, row.id);
  }
  const whyReasons: WhyReason[] = own
    ? [
        ...(own.unknownReason === 'NO_MEMBERS'
          ? [{ text: 'No member services yet, so health is unknown. Add services to monitor it.' }]
          : []),
        ...own.reasons.map(reason => {
          const incidentId =
            reason.kind === 'DIRECT' || reason.kind === 'DEPENDENCY'
              ? openByService.get(reason.serviceId)
              : undefined;
          return {
            text: describeReason(reason, {
              services: knownServices,
              businessServices: knownBusiness,
            }),
            ...(incidentId ? { href: `/incidents/${incidentId}` } : {}),
          };
        }),
      ].filter((reason, index, all) => all.findIndex(other => other.text === reason.text) === index)
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
  const following =
    (await prisma.businessServiceFollower.count({
      where: { businessServiceId: item.id, userId: actor.id },
    })) > 0;
  const links = safeLinks(item.links);
  const budget = item.sloTarget === null ? null : await budgetOf(item.id).catch(() => undefined);
  const impacted = own !== null && own.status !== 'OPERATIONAL';
  // eslint-disable-next-line react-hooks/purity -- a server render stamps when its data was read
  const renderedAt = Date.now();

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
      {!item.criticality && (
        <InlineNotice tone="warning" title="Criticality is not set">
          Every open incident on a member counts as impact until a tier is set. Set one to filter
          out low-urgency noise.
          {canManage && (
            <>
              {' '}
              <Link
                href={`/services/business/${item.id}/edit#bs-criticality`}
                className="font-medium underline underline-offset-2"
              >
                Set criticality
              </Link>
            </>
          )}
        </InlineNotice>
      )}
      {/* Healthy services skip the "why" card; an impacted one leads with it and its incidents. */}
      {impacted && own && <WhyStatusCard status={own.status} reasons={whyReasons} />}
      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Suspense fallback={<SectionSkeleton title="Incidents" height="h-40" />}>
            {canReadIncidents ? (
              <IncidentsSection id={item.id} memberIds={memberIds} actor={actor} />
            ) : (
              <IncidentCountSection id={item.id} actor={actor} open={own?.openIncidentCount ?? 0} />
            )}
          </Suspense>
          <Suspense fallback={<KpiGridSkeleton count={item.sloTarget === null ? 4 : 5} />}>
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
          <Suspense
            fallback={<SectionSkeleton title={`Impact, last ${impactDays} days`} height="h-24" />}
          >
            <TimelineSection
              id={item.id}
              actor={actor}
              days={impactDays}
              showIncidents={canReadIncidents}
              cost={canReadIncidents ? item : undefined}
              canUnmark={canManage}
            />
          </Suspense>
          {canReadIncidents && (
            <Suspense fallback={<SectionSkeleton title="Customer impact" height="h-24" />}>
              <CustomerImpactSection item={item} actor={actor} canAdd={canManage} />
            </Suspense>
          )}
        </div>
        <DetailsPanel
          lifecycle={item.lifecycle}
          environment={item.environment}
          tags={item.tags}
          links={links}
          attributes={item.customAttributes}
          contactChannel={item.contactChannel}
          contactHref={contactChannelHref(item.contactChannel)}
          lastReviewedAt={item.lastReviewedAt}
        >
          <DependencyHealthSummary
            supporting={related(children)}
            technicalCount={technical.length}
            tabHref={`/services/business/${item.id}?tab=dependencies`}
          />
        </DetailsPanel>
      </div>
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
          <>
            {own ? (
              <HealthBadge status={own.status} since={own.since} variant="solid" />
            ) : (
              <span className={pageHeaderBadgeClass}>Health unavailable</span>
            )}
            {item.criticality && (
              <span className={pageHeaderBadgeClass} title={CRITICALITY_HINT[item.criticality]}>
                {CRITICALITY_LABEL[item.criticality]} · {CRITICALITY_HINT[item.criticality]}
              </span>
            )}
            {item.lifecycle !== 'ACTIVE' && (
              <span className={pageHeaderBadgeClass}>{LIFECYCLE_LABEL[item.lifecycle]}</span>
            )}
          </>
        }
        description={item.description ?? undefined}
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
            label: 'Error budget',
            value:
              item.sloTarget === null
                ? 'No SLO'
                : budget
                  ? `${Math.max(budget.remainingPercent, 0).toFixed(0)}% left`
                  : '—',
            subtext:
              item.sloTarget === null
                ? undefined
                : `${item.sloTarget}% over ${item.sloWindowDays} days${budget ? ` · ${BUDGET_STATE[budget.burnState]}` : ''}`,
          },
          {
            label: 'Open incidents',
            value: own ? own.openIncidentCount.toLocaleString() : '—',
            subtext: own?.impactedMemberCount
              ? `${own.impactedMemberCount} of ${memberIds.length} services impacted`
              : undefined,
          },
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
            <SlaReportMenu
              businessServiceId={item.id}
              className={cn('gap-1.5', pageHeaderActionClass)}
            />
            <CopyLinkButton
              path={`/services/business/${item.id}`}
              className={pageHeaderActionClass}
            />
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

      <div className="flex justify-end">
        <AutoRefresh seconds={60} renderedAt={renderedAt} />
      </div>
      <DetailTabs
        label="Business service sections"
        defaultTab={tab}
        navigationMode="server"
        tabs={[
          { id: 'overview', label: 'Overview', content: tab === 'overview' ? overview : null },
          {
            id: 'members',
            label: 'Members',
            count: memberIds.length,
            content:
              tab === 'members' ? (
                <div className={TAB_CARD}>
                  <MembersPanel
                    members={members}
                    supporting={related(children)}
                    addAction={
                      canManage ? (
                        <AddMembersDialog businessServiceId={item.id} existingIds={memberIds} />
                      ) : undefined
                    }
                  />
                </div>
              ) : null,
          },
          {
            id: 'dependencies',
            label: 'Dependencies',
            count: children.length + parents.length + technical.length,
            content:
              tab === 'dependencies' ? (
                <div className={TAB_CARD}>
                  <DependenciesPanel
                    businessServiceId={item.id}
                    supporting={related(children)}
                    dependents={related(parents)}
                    technical={technical}
                  />
                </div>
              ) : null,
          },
          {
            id: 'status-pages',
            label: 'Status pages',
            count: item._count.statusPages,
            content:
              tab === 'status-pages' ? (
                <Suspense fallback={<SectionSkeleton title="Status pages" height="h-24" />}>
                  <StatusPagesSection
                    id={item.id}
                    // The status-page settings are admin-only, so Configure links need ADMIN_MANAGE.
                    canManage={actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE)}
                  />
                </Suspense>
              ) : null,
          },
          {
            id: 'followers',
            label: 'Followers',
            count: item._count.followers,
            content:
              tab === 'followers' ? (
                <Suspense fallback={<SectionSkeleton title="Followers" height="h-24" />}>
                  <FollowersSection
                    id={item.id}
                    followAction={
                      <BusinessServiceFollowButton
                        id={item.id}
                        name={item.name}
                        following={following}
                      />
                    }
                  />
                </Suspense>
              ) : null,
          },
          {
            id: 'changes',
            label: 'Changes',
            content:
              tab === 'changes' ? (
                <Suspense fallback={<SectionSkeleton title="Changes" height="h-24" />}>
                  <ChangesSection businessServiceId={item.id} actor={actor} />
                </Suspense>
              ) : null,
          },
          ...(canReadAudit
            ? [
                {
                  id: 'activity',
                  label: 'Activity',
                  content:
                    tab === 'activity' ? (
                      <Suspense fallback={<SectionSkeleton title="Activity" height="h-24" />}>
                        <ActivitySection id={item.id} limit={activityLimit} />
                      </Suspense>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
