/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier, urgency), never request input */
import Link from 'next/link';
import { Boxes, MonitorCheck, Plus } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requirePageAccess } from '@/lib/access/server';
import { CAPABILITIES } from '@/lib/authorization';
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
import HealthUnavailable from '@/components/business-service/HealthUnavailable';
import { BS_STATUS_META, CRITICALITY_LABEL } from '@/components/business-service/HealthBadge';
import {
  catalogHref,
  countMatching,
  hasActiveFilters,
  isImpacted,
  parseCatalogParams,
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
 * pages. One `listBusinessServices` call per page; header and footer counts come from one scoped
 * query plus the (cached) health of every visible business service.
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
      ownerTeam: { select: { id: true, name: true } },
      _count: { select: { followers: true } },
      followers: { where: { userId: actor.id }, select: { userId: true } },
    },
  });
  const byId = new Map(visible.map(row => [row.id, row]));

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

  const impactedNow = engine
    ? [...engine.health.values()].filter(entry => isImpacted(entry.status)).length
    : null;
  const tierCounts = TIERS.map(tier => ({
    tier,
    count: visible.filter(row => row.criticality === tier).length,
  })).filter(entry => entry.count > 0);
  const base = { q: '', tier: '', status: '', team: '' } as const;
  const stats: DetailStatItem[] = [
    { label: 'Business services', value: visible.length.toLocaleString() },
    {
      label: 'Impacted now',
      value: impactedNow === null ? '—' : impactedNow.toLocaleString(),
      href: catalogHref({ ...base, status: 'impacted' }),
      active: query.status === 'impacted' && !query.tier,
    },
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
        const extra = byId.get(item.id);
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
          followerCount: extra?._count.followers ?? 0,
          following: Boolean(extra?.followers.length),
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
          <Button asChild size="sm" className={cn('gap-1.5', pageHeaderActionClass)}>
            <Link href="/status-dashboard">
              <MonitorCheck className="h-4 w-4" aria-hidden />
              Status dashboard
            </Link>
          </Button>
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
            name: 'team',
            label: 'Owner team',
            value: query.team,
            anyLabel: 'All teams',
            options: teams.map(([value, label]) => ({ value, label })),
          },
        ]}
      />

      {engine ? (
        <CatalogDirectory
          rows={rows}
          filtered={filtered}
          clearHref="/services/business"
          canManage={canManage}
          pagination={{
            page: engine.cursors.length + 1,
            pageSize: PAGE_SIZE,
            totalCount: countMatching(visible, engine.health, query),
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
