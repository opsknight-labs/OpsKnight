/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier, urgency), never request input */
import Link from 'next/link';
import { Boxes, MonitorCheck, Plus, Wand2 } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requirePageAccess } from '@/lib/access/server';
import { CAPABILITIES } from '@/lib/authorization';
import { teamReadWhere } from '@/lib/authorization-filters';
import { actorHasCapability } from '@/lib/authorization-policy';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import { getBusinessServiceHealth, listBusinessServices } from '@/lib/business-services/contract';
import { orUnavailable } from '@/lib/business-services/dashboards';
import { AppError } from '@/lib/errors';
import { PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { Button } from '@/components/ui/shadcn/button';
import ListFilterBar from '@/components/intelligence/lists/ListFilterBar';
import CatalogDirectory, { type CatalogRow } from '@/components/business-service/CatalogDirectory';
import HygieneToggle from '@/components/business-service/HygieneToggle';
import { hygieneBadges } from '@/lib/business-services/hygiene';
import HealthUnavailable from '@/components/business-service/HealthUnavailable';
import { BS_STATUS_META, CRITICALITY_LABEL } from '@/components/business-service/HealthBadge';
import {
  catalogHref,
  countMatching,
  hasActiveFilters,
  isImpacted,
  parseCatalogParams,
  scoreRow,
  type CatalogSearchParams,
} from '@/components/business-service/catalog-model';
import type { DetailStatItem } from '@/components/ui/DetailHeroBanner';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE = 25;
const TIERS = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;
const STATUS_CHIPS = [
  { value: 'impacted', label: 'Impacted', tone: 'critical' },
  { value: 'MAJOR_OUTAGE', label: BS_STATUS_META.MAJOR_OUTAGE.label, tone: 'critical' },
  { value: 'PARTIAL_OUTAGE', label: BS_STATUS_META.PARTIAL_OUTAGE.label, tone: 'elevated' },
  { value: 'DEGRADED', label: BS_STATUS_META.DEGRADED.label, tone: 'elevated' },
  { value: 'MAINTENANCE', label: BS_STATUS_META.MAINTENANCE.label, tone: 'info' },
  { value: 'OPERATIONAL', label: BS_STATUS_META.OPERATIONAL.label, tone: 'ok' },
] as const;

/**
 * Business-service catalog: PageHeader (totals, impacted now, tiers) → FilterBar → directory with keyset
 * pages. One `listBusinessServices` call per page; header and footer counts come from one lean scoped
 * read (no per-row follower subqueries) plus the (cached) health of every visible business service.
 */
export default async function BusinessServicesPage({
  searchParams,
}: {
  searchParams?: Promise<CatalogSearchParams>;
}) {
  await requirePageAccess('/services/business');
  const actor = await getCurrentAuthorizationActor();
  const canManage = actorHasCapability(actor, CAPABILITIES.OPERATIONS_MANAGE);
  const { query, filter, cursors: requested } = parseCatalogParams(await searchParams);

  const visible = await prisma.businessService.findMany({
    where: businessServiceReadWhere(actor),
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      criticality: true,
      ownerTeamId: true,
      ownerUserId: true,
      _count: { select: { members: true } },
      ownerTeam: { select: { id: true, name: true } },
    },
  });
  const countable = visible.map(row => ({ ...row, memberCount: row._count.members }));

  const list = (cursor: string | null) =>
    listBusinessServices({ filter, cursor, limit: PAGE_SIZE }, actor);
  const loadPage = async () => {
    try {
      return { page: await list(requested.at(-1) ?? null), cursors: requested };
    } catch (error) {
      // A stale cursor (its business service was deleted) starts over at the first page.
      if (!(error instanceof AppError) || error.code !== 'INVALID_PAGINATION_CURSOR') throw error;
      return { page: await list(null), cursors: [] as string[] };
    }
  };
  const engine = await orUnavailable(
    Promise.all([
      loadPage(),
      getBusinessServiceHealth(
        visible.map(row => row.id),
        actor
      ),
    ]).then(([{ page, cursors }, health]) => ({ page, cursors, health })),
    'business_services.catalog.unavailable'
  );

  // Follower counts only for the rows on this page, not for every visible business service.
  const pageIds = engine?.page.items.map(item => item.id) ?? [];
  const followers = pageIds.length
    ? await prisma.businessServiceFollower.groupBy({
        by: ['businessServiceId'],
        where: { businessServiceId: { in: pageIds } },
        _count: { _all: true },
      })
    : [];
  const following = pageIds.length
    ? await prisma.businessServiceFollower.findMany({
        where: { businessServiceId: { in: pageIds }, userId: actor.id },
        select: { businessServiceId: true },
      })
    : [];
  const hygieneRows = pageIds.length
    ? await prisma.businessService.findMany({
        where: { id: { in: pageIds } },
        select: {
          id: true,
          createdAt: true,
          lastReviewedAt: true,
          reviewIntervalDays: true,
          ownerUserId: true,
          ownerUser: { select: { status: true } },
        },
      })
    : [];
  const hygieneById = new Map(
    hygieneRows.map(row => [
      row.id,
      hygieneBadges({ ...row, ownerUserStatus: row.ownerUser?.status ?? null }),
    ])
  );
  const bulkTeams = canManage
    ? await prisma.team.findMany({
        where: teamReadWhere(actor),
        orderBy: { name: 'asc' },
        take: 200,
        select: { id: true, name: true },
      })
    : [];
  const isAdmin = actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE);
  const hygieneEnabled = isAdmin
    ? ((
        await prisma.systemSettings.findUnique({
          where: { id: 'default' },
          select: { businessServiceHygieneEnabled: true },
        })
      )?.businessServiceHygieneEnabled ?? false)
    : false;
  const followerCounts = new Map(followers.map(row => [row.businessServiceId, row._count._all]));
  const followingIds = new Set(following.map(row => row.businessServiceId));

  const impactedNow = engine
    ? [...engine.health.values()].filter(entry => isImpacted(entry.status)).length
    : null;
  const tierCounts = TIERS.map(tier => ({
    tier,
    count: visible.filter(row => row.criticality === tier).length,
  })).filter(entry => entry.count > 0);
  const needsAttention = countable.filter(row => scoreRow(row).needsAttention).length;
  const base = { q: '', tier: '', status: '', team: '', needs: '' } as const;
  const stats: DetailStatItem[] = [
    { label: 'Business services', value: visible.length.toLocaleString() },
    {
      label: 'Impacted now',
      value: impactedNow === null ? '—' : impactedNow.toLocaleString(),
      href: catalogHref({ ...base, status: 'impacted' }),
      active: query.status === 'impacted' && !query.tier,
    },
    ...(needsAttention
      ? [
          {
            label: 'Needs attention',
            value: needsAttention.toLocaleString(),
            subtext: 'no owner, tier or services',
            href: catalogHref({ ...base, needs: 'attention' }),
            active: query.needs === 'attention',
          },
        ]
      : []),
    ...tierCounts.map(({ tier, count }) => ({
      label: CRITICALITY_LABEL[tier],
      value: count.toLocaleString(),
      href: catalogHref({ ...base, tier }),
      active: query.tier === tier && !query.status,
    })),
  ];

  const teams = [
    ...new Map(
      visible.flatMap(row => (row.ownerTeam ? [[row.ownerTeam.id, row.ownerTeam.name]] : []))
    ),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const rows: CatalogRow[] = engine
    ? engine.page.items.map(item => {
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          criticality: item.criticality,
          ownerTeam: item.ownerTeam,
          status: item.health.status,
          since: item.health.since,
          memberCount: item.memberCount,
          impactedMemberCount: item.health.impactedMemberCount,
          openIncidentCount: item.health.openIncidentCount,
          followerCount: followerCounts.get(item.id) ?? 0,
          following: followingIds.has(item.id),
          hygiene: hygieneById.get(item.id),
        };
      })
    : [];
  const filtered = hasActiveFilters(query);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        eyebrow="Service Catalog"
        title="Business services"
        icon={Boxes}
        breadcrumbs={[{ label: 'Services', href: '/services' }, { label: 'Business services' }]}
        description="What customers rely on, like Checkout or Payments, and how it is doing right now."
        stats={stats}
        secondaryActions={
          <>
            {canManage && (
              <Button asChild size="sm" className={cn('gap-1.5', pageHeaderActionClass)}>
                <Link href="/services/business/setup">
                  <Wand2 className="h-4 w-4" aria-hidden />
                  Guided setup
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild size="sm" className={cn('gap-1.5', pageHeaderActionClass)}>
                <Link href="/services/business/templates">Templates</Link>
              </Button>
            )}
            <Button asChild size="sm" className={cn('gap-1.5', pageHeaderActionClass)}>
              <Link href="/status-dashboard">
                <MonitorCheck className="h-4 w-4" aria-hidden />
                Status dashboard
              </Link>
            </Button>
          </>
        }
        primaryAction={
          canManage ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/services/business/new">
                <Plus className="h-4 w-4" aria-hidden />
                New business service
              </Link>
            </Button>
          ) : undefined
        }
      />

      <ListFilterBar
        basePath="/services/business"
        label="Filter business services"
        description="Find a business service by name, health, tier or owner."
        search={{
          value: query.q,
          placeholder: 'Search by name',
          label: 'Search business services',
        }}
        chips={{
          name: 'status',
          label: 'Health',
          value: query.status,
          anyLabel: 'Any health',
          options: STATUS_CHIPS,
        }}
        fields={[
          {
            name: 'tier',
            label: 'Criticality',
            value: query.tier,
            anyLabel: 'All tiers',
            options: TIERS.map(tier => ({ value: tier, label: CRITICALITY_LABEL[tier] })),
          },
          {
            name: 'needs',
            label: 'Needs',
            value: query.needs,
            anyLabel: 'Anything',
            options: [
              { value: 'attention', label: 'Needs attention' },
              { value: 'no-owner', label: 'No owner' },
              { value: 'no-tier', label: 'No tier' },
              { value: 'no-members', label: 'No services' },
            ],
          },
          {
            name: 'team',
            label: 'Owner team',
            value: query.team,
            anyLabel: 'All teams',
            options: teams.map(([value, label]) => ({ value, label })),
          },
        ]}
      />

      {isAdmin && <HygieneToggle enabled={hygieneEnabled} />}

      {engine ? (
        <CatalogDirectory
          teams={bulkTeams}
          rows={rows}
          filtered={filtered}
          clearHref="/services/business"
          canManage={canManage}
          pagination={{
            page: engine.cursors.length + 1,
            pageSize: PAGE_SIZE,
            totalCount: countMatching(countable, engine.health, query),
            prevHref: engine.cursors.length
              ? catalogHref(query, engine.cursors.slice(0, -1))
              : undefined,
            nextHref: engine.page.nextCursor
              ? catalogHref(query, [...engine.cursors, engine.page.nextCursor])
              : undefined,
          }}
        />
      ) : (
        <HealthUnavailable />
      )}
    </div>
  );
}
