import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { AlertTriangle, Plus, SearchX } from 'lucide-react';
import MobileIncidentList, { type IncidentFilter } from '@/components/mobile/MobileIncidentList';
import MobileListControls from '@/components/mobile/MobileListControls';
import { Card } from '@/components/ui/shadcn/card';
import prisma from '@/lib/prisma';
import { activeIncidentStatuses, mutedIncidentStatuses } from '@/lib/incident-status';
import { normalizeIncidentStatus } from '@/lib/incidents-query';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
type MobileIncidentSort = 'created_desc' | 'created_asc' | 'urgency';

function normalizeFilter(value?: string): IncidentFilter {
  if (value === 'all_open' || value === 'muted' || value === 'open' || value === 'acknowledged' || value === 'resolved') {
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
    searchParams?.urgency === 'HIGH' || searchParams?.urgency === 'MEDIUM' || searchParams?.urgency === 'LOW'
      ? searchParams.urgency
      : undefined;
  const resolvedAfter = searchParams?.resolvedAfter ? new Date(searchParams.resolvedAfter) : undefined;
  const createdAfter = searchParams?.createdAfter ? new Date(searchParams.createdAfter) : undefined;
  const createdBefore = searchParams?.createdBefore ? new Date(searchParams.createdBefore) : undefined;
  const page = Math.max(1, Number.parseInt(searchParams?.page || '1', 10) || 1);

  const selectedWhere: Prisma.IncidentWhereInput = {};
  if (query) selectedWhere.title = { contains: query, mode: 'insensitive' };

  if (filter === 'all_open') selectedWhere.status = { in: activeIncidentStatuses() };
  else if (filter === 'muted') selectedWhere.status = { in: mutedIncidentStatuses() };
  else if (filter === 'open') selectedWhere.status = 'OPEN';
  else if (filter === 'acknowledged') selectedWhere.status = 'ACKNOWLEDGED';
  else if (filter === 'resolved') selectedWhere.status = 'RESOLVED';

  if (status) selectedWhere.status = status;
  if (assignee) selectedWhere.assigneeId = assignee.toLowerCase() === 'unassigned' ? null : assignee;
  if (serviceId) selectedWhere.serviceId = serviceId;
  if (urgency) selectedWhere.urgency = urgency;
  if (resolvedAfter && !Number.isNaN(resolvedAfter.getTime())) selectedWhere.resolvedAt = { gte: resolvedAfter };
  if (createdAfter && !Number.isNaN(createdAfter.getTime())) {
    selectedWhere.createdAt = { ...(selectedWhere.createdAt as Prisma.DateTimeFilter), gte: createdAfter };
  }
  if (createdBefore && !Number.isNaN(createdBefore.getTime())) {
    selectedWhere.createdAt = { ...(selectedWhere.createdAt as Prisma.DateTimeFilter), lte: createdBefore };
  }

  const orderBy: Prisma.IncidentOrderByWithRelationInput[] =
    sort === 'created_asc'
      ? [{ createdAt: 'asc' }]
      : sort === 'urgency'
        ? [{ urgency: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

  const where: Prisma.IncidentWhereInput = {
    AND: [incidentReadWhere(context.actor), selectedWhere],
  };

  const [incidents, totalCount] = await Promise.all([
    prisma.incident.findMany({
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
    }),
    prisma.incident.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const startIndex = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIndex = Math.min(page * PAGE_SIZE, totalCount);

  const buildPageUrl = (newPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (filter !== 'all') params.set('filter', filter);
    if (sort !== 'created_desc') params.set('sort', sort);
    if (status) params.set('status', status);
    if (assignee) params.set('assignee', assignee);
    if (serviceId) params.set('serviceId', serviceId);
    if (urgency) params.set('urgency', urgency);
    if (resolvedAfter && !Number.isNaN(resolvedAfter.getTime())) params.set('resolvedAfter', resolvedAfter.toISOString());
    if (createdAfter && !Number.isNaN(createdAfter.getTime())) params.set('createdAfter', createdAfter.toISOString());
    if (createdBefore && !Number.isNaN(createdBefore.getTime())) params.set('createdBefore', createdBefore.toISOString());
    if (newPage > 1) params.set('page', String(newPage));
    const suffix = params.toString();
    return suffix ? `/m/incidents?${suffix}` : '/m/incidents';
  };

  const hasFilters = Boolean(query || filter !== 'all' || sort !== 'created_desc' || status || assignee || serviceId || urgency);

  return (
    <div className="responsive-page space-y-4 px-3 py-4 sm:px-4">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-foreground">Incidents</h1>
              <p className="text-xs text-muted-foreground">
                {totalCount === 0 ? 'No matching incidents' : `${startIndex}–${endIndex} of ${totalCount}`}
              </p>
            </div>
          </div>
        </div>
        <Link
          href="/m/incidents/create"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </Link>
      </header>

      <MobileListControls
        basePath="/m/incidents"
        placeholder="Search incidents…"
        filters={[
          { label: 'All', value: 'all' },
          { label: 'Active', value: 'all_open' },
          { label: 'Muted', value: 'muted' },
          { label: 'Triggered', value: 'open' },
          { label: 'Acknowledged', value: 'acknowledged' },
          { label: 'Resolved', value: 'resolved' },
        ]}
        sortOptions={[
          { label: 'Newest first', value: 'created_desc' },
          { label: 'Oldest first', value: 'created_asc' },
          { label: 'Urgency first', value: 'urgency' },
        ]}
      />

      {incidents.length === 0 ? (
        <Card className="rounded-2xl border-dashed border-border bg-card px-5 py-10 text-center shadow-none">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="mt-3 text-sm font-bold text-foreground">No incidents found</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {query ? `Nothing matches “${query}”.` : 'Try changing the current filters or create an incident.'}
          </p>
          <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href="/m/incidents/create" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create incident
            </Link>
            {hasFilters && (
              <Link href="/m/incidents" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground">
                Clear filters
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <MobileIncidentList incidents={incidents} filter={filter} />
      )}

      {totalPages > 1 && (
        <nav aria-label="Incident result navigation" className="grid grid-cols-2 gap-2.5 pt-1">
          {page > 1 ? (
            <Link
              href={buildPageUrl(page - 1)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-sm"
            >
              Newer incidents
            </Link>
          ) : <span />}
          {page < totalPages ? (
            <Link
              href={buildPageUrl(page + 1)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm"
            >
              Show more
            </Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
