import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { Plus, SearchX } from 'lucide-react';
import MobileIncidentList, { type IncidentFilter } from '@/components/mobile/MobileIncidentList';
import MobileIncidentFilters from '@/components/mobile/MobileIncidentFilters';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import prisma from '@/lib/prisma';
import { activeIncidentStatuses, mutedIncidentStatuses } from '@/lib/incident-status';
import { normalizeIncidentStatus } from '@/lib/incidents-query';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
type MobileIncidentSort = 'created_desc' | 'created_asc' | 'urgency';

function normalizeFilter(value?: string): IncidentFilter {
  if (
    value === 'all_open' ||
    value === 'muted' ||
    value === 'open' ||
    value === 'acknowledged' ||
    value === 'resolved'
  ) {
    return value;
  }
  return 'all';
}

function normalizeSort(value?: string): MobileIncidentSort {
  return value === 'created_asc' || value === 'urgency' ? value : 'created_desc';
}

export default async function MobileIncidentsPage(props: {
  searchParams?: Promise<{
    q?: string;
    filter?: string;
    page?: string;
    sort?: string;
    status?: string;
    assignee?: string;
    serviceId?: string;
    urgency?: string;
    resolvedAfter?: string;
    createdAfter?: string;
    createdBefore?: string;
  }>;
}) {
  const context = await getRequestActorContext();
  if (!context) redirect('/login?callbackUrl=/m/incidents');

  const searchParams = await props.searchParams;
  const query = searchParams?.q?.trim() || '';
  const filter = normalizeFilter(searchParams?.filter);
  const sort = normalizeSort(searchParams?.sort);
  const status = normalizeIncidentStatus(searchParams?.status);
  const assignee = searchParams?.assignee;
  const serviceId = searchParams?.serviceId;
  const urgency =
    searchParams?.urgency === 'HIGH' ||
    searchParams?.urgency === 'MEDIUM' ||
    searchParams?.urgency === 'LOW'
      ? searchParams.urgency
      : undefined;
  const resolvedAfter = searchParams?.resolvedAfter
    ? new Date(searchParams.resolvedAfter)
    : undefined;
  const createdAfter = searchParams?.createdAfter ? new Date(searchParams.createdAfter) : undefined;
  const createdBefore = searchParams?.createdBefore
    ? new Date(searchParams.createdBefore)
    : undefined;
  const page = Math.max(1, Number.parseInt(searchParams?.page || '1', 10) || 1);

  const selectedWhere: Prisma.IncidentWhereInput = {};
  if (query) selectedWhere.title = { contains: query, mode: 'insensitive' };

  if (filter === 'all_open') selectedWhere.status = { in: activeIncidentStatuses() };
  else if (filter === 'muted') selectedWhere.status = { in: mutedIncidentStatuses() };
  else if (filter === 'open') selectedWhere.status = 'OPEN';
  else if (filter === 'acknowledged') selectedWhere.status = 'ACKNOWLEDGED';
  else if (filter === 'resolved') selectedWhere.status = 'RESOLVED';

  if (status) selectedWhere.status = status;
  if (assignee)
    selectedWhere.assigneeId = assignee.toLowerCase() === 'unassigned' ? null : assignee;
  if (serviceId) selectedWhere.serviceId = serviceId;
  if (urgency) selectedWhere.urgency = urgency;
  if (resolvedAfter && !Number.isNaN(resolvedAfter.getTime()))
    selectedWhere.resolvedAt = { gte: resolvedAfter };
  if (createdAfter && !Number.isNaN(createdAfter.getTime())) {
    selectedWhere.createdAt = {
      ...(selectedWhere.createdAt as Prisma.DateTimeFilter),
      gte: createdAfter,
    };
  }
  if (createdBefore && !Number.isNaN(createdBefore.getTime())) {
    selectedWhere.createdAt = {
      ...(selectedWhere.createdAt as Prisma.DateTimeFilter),
      lte: createdBefore,
    };
  }

  const where: Prisma.IncidentWhereInput = {
    AND: [incidentReadWhere(context.actor), selectedWhere],
  };

  const [totalCount, services] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.service.findMany({
      where: serviceReadWhere(context.actor),
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  type IncidentItem = React.ComponentProps<typeof MobileIncidentList>['incidents'][number];
  let incidents: IncidentItem[] = [];

  if (sort === 'urgency') {
    // Rank urgency explicitly: HIGH > MEDIUM > LOW, avoiding PostgreSQL enum sequence
    const skip = (page - 1) * PAGE_SIZE;
    const take = PAGE_SIZE;
    const [highCount, medCount] = await Promise.all([
      prisma.incident.count({ where: { AND: [where, { urgency: 'HIGH' }] } }),
      prisma.incident.count({ where: { AND: [where, { urgency: 'MEDIUM' }] } }),
    ]);

    const tiers: Array<{ urgency: 'HIGH' | 'MEDIUM' | 'LOW'; count: number }> = [
      { urgency: 'HIGH', count: highCount },
      { urgency: 'MEDIUM', count: medCount },
      { urgency: 'LOW', count: Math.max(0, totalCount - highCount - medCount) },
    ];

    let currentSkip = skip;
    let remainingTake = take;

    for (const tier of tiers) {
      if (remainingTake <= 0) break;
      if (currentSkip >= tier.count) {
        currentSkip -= tier.count;
        continue;
      }
      const tierTake = Math.min(remainingTake, tier.count - currentSkip);
      const tierIncidents = await prisma.incident.findMany({
        where: { AND: [where, { urgency: tier.urgency }] },
        orderBy: [{ createdAt: 'desc' }],
        skip: currentSkip,
        take: tierTake,
        select: {
          id: true,
          title: true,
          status: true,
          urgency: true,
          createdAt: true,
          service: { select: { name: true } },
        },
      });
      incidents.push(...(tierIncidents as IncidentItem[]));
      remainingTake -= tierIncidents.length;
      currentSkip = 0;
    }
  } else {
    const orderBy: Prisma.IncidentOrderByWithRelationInput[] =
      sort === 'created_asc' ? [{ createdAt: 'asc' }] : [{ createdAt: 'desc' }];

    incidents = (await prisma.incident.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        createdAt: true,
        service: { select: { name: true } },
      },
    })) as IncidentItem[];
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const buildPageUrl = (newPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (filter !== 'all') params.set('filter', filter);
    if (sort !== 'created_desc') params.set('sort', sort);
    if (status) params.set('status', status);
    if (assignee) params.set('assignee', assignee);
    if (serviceId) params.set('serviceId', serviceId);
    if (urgency) params.set('urgency', urgency);
    if (resolvedAfter && !Number.isNaN(resolvedAfter.getTime()))
      params.set('resolvedAfter', resolvedAfter.toISOString());
    if (createdAfter && !Number.isNaN(createdAfter.getTime()))
      params.set('createdAfter', createdAfter.toISOString());
    if (createdBefore && !Number.isNaN(createdBefore.getTime()))
      params.set('createdBefore', createdBefore.toISOString());
    if (newPage > 1) params.set('page', String(newPage));
    const suffix = params.toString();
    return suffix ? `/m/incidents?${suffix}` : '/m/incidents';
  };

  const hasFilters = Boolean(
    query ||
    filter !== 'all' ||
    sort !== 'created_desc' ||
    status ||
    assignee ||
    serviceId ||
    urgency
  );

  return (
    <div className="responsive-page space-y-4">
      <MobileIncidentFilters
        currentQuery={query}
        currentFilter={filter}
        currentUrgency={urgency}
        currentAssignee={assignee}
        currentServiceId={serviceId}
        currentSort={sort}
        currentUserId={context.user.id}
        services={services}
        totalCount={totalCount}
      />

      {incidents.length === 0 ? (
        <EmptyState
          icon={<SearchX aria-hidden="true" />}
          title="No incidents found"
          description={
            query ? `Nothing matches “${query}”.` : 'Change the filters or create a new incident.'
          }
          size="sm"
          action={
            <Button asChild size="sm">
              <Link href="/m/incidents/create">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                New incident
              </Link>
            </Button>
          }
          secondaryAction={
            hasFilters ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/m/incidents">Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <MobileIncidentList incidents={incidents} filter={filter} />
      )}

      {totalPages > 1 && (
        <nav
          aria-label="Incident result navigation"
          className="flex items-center justify-center gap-2 pt-1"
        >
          {page > 1 && (
            <Button asChild variant="outline" size="sm" className="h-10 rounded-xl">
              <Link href={buildPageUrl(page - 1)}>Newer</Link>
            </Button>
          )}
          {page < totalPages && (
            <Button asChild size="sm" className="h-10 rounded-xl px-5">
              <Link href={buildPageUrl(page + 1)}>Load older incidents</Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
