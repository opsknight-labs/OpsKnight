import Link from 'next/link';
import MobileIncidentList, { type IncidentFilter } from '@/components/mobile/MobileIncidentList';
import MobileListControls from '@/components/mobile/MobileListControls';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AlertTriangle, Plus, ChevronLeft, ChevronRight, SearchX } from 'lucide-react';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
type MobileIncidentSort = 'created_desc' | 'created_asc' | 'urgency';

const normalizeFilter = (value?: string): IncidentFilter => {
  if (value === 'open' || value === 'acknowledged' || value === 'resolved') {
    return value;
  }
  return 'all';
};

const normalizeSort = (value?: string): MobileIncidentSort => {
  if (value === 'created_asc' || value === 'urgency') {
    return value;
  }
  return 'created_desc';
};

export default async function MobileIncidentsPage(props: {
  searchParams?: Promise<{ q?: string; filter?: string; page?: string; sort?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams?.q || '';
  const filter = normalizeFilter(searchParams?.filter);
  const sort = normalizeSort(searchParams?.sort);
  const page = Math.max(1, parseInt(searchParams?.page || '1', 10));

  const where: Prisma.IncidentWhereInput = {};

  if (query) {
    where.title = { contains: query, mode: 'insensitive' };
  }

  if (filter === 'open') {
    where.status = 'OPEN';
  } else if (filter === 'acknowledged') {
    where.status = 'ACKNOWLEDGED';
  } else if (filter === 'resolved') {
    where.status = 'RESOLVED';
  }

  const orderBy: Prisma.IncidentOrderByWithRelationInput[] =
    sort === 'created_asc'
      ? [{ createdAt: 'asc' }]
      : sort === 'urgency'
        ? [{ urgency: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

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
        assignee: { select: { id: true, name: true, avatarUrl: true, gender: true } },
      },
    }),
    prisma.incident.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE + 1;
  const endIndex = Math.min(page * PAGE_SIZE, totalCount);

  const buildPageUrl = (newPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (filter && filter !== 'all') params.set('filter', filter);
    if (sort && sort !== 'created_desc') params.set('sort', sort);
    params.set('page', newPage.toString());
    return `/m/incidents?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)] flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-primary" />
            Incidents
          </h1>
          <p className="text-xs font-medium text-[color:var(--text-muted)] mt-0.5">
            {totalCount > 0 ? `${startIndex}-${endIndex} of ${totalCount}` : '0 incidents'}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <MobileListControls
        basePath="/m/incidents"
        placeholder="Search incidents..."
        filters={[
          { label: 'All', value: 'all' },
          { label: 'Open', value: 'open' },
          { label: 'Acknowledged', value: 'acknowledged' },
          { label: 'Resolved', value: 'resolved' },
        ]}
        sortOptions={[
          { label: 'Newest first', value: 'created_desc' },
          { label: 'Oldest first', value: 'created_asc' },
          { label: 'Urgency first', value: 'urgency' },
        ]}
      />

      {/* Create Button */}
      <Link
        href="/m/incidents/create"
        className="flex items-center justify-center gap-2 rounded-xl bg-primary text-white py-3 px-4 font-semibold text-sm shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        New Incident
      </Link>

      {/* Incident List */}
      {incidents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-surface)] py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--bg-secondary)] text-[color:var(--text-muted)]">
            <SearchX className="h-7 w-7" />
          </div>
          <div>
            <p className="font-semibold text-[color:var(--text-primary)]">No incidents found</p>
            <p className="text-sm text-[color:var(--text-muted)] mt-1">
              {query ? `No match for "${query}"` : 'Change filters or create a new one'}
            </p>
          </div>
          <div className="flex flex-col gap-2 mt-2">
            <Link
              href="/m/incidents/create"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-white py-2 px-4 font-semibold text-sm transition-all active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              Create incident
            </Link>
            {(query || filter !== 'all' || sort !== 'created_desc') && (
              <Link
                href="/m/incidents"
                className="inline-flex items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] py-2 px-4 font-medium text-sm transition-all active:scale-[0.98]"
              >
                Reset filters
              </Link>
            )}
          </div>
        </div>
      ) : (
        <MobileIncidentList incidents={incidents} filter={filter} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 pt-2">
          {page > 1 ? (
            <Link
              href={buildPageUrl(page - 1)}
              className="flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm font-medium text-[color:var(--text-secondary)] transition-all active:scale-[0.98]"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Link>
          ) : (
            <div />
          )}

          <span className="text-sm font-medium text-[color:var(--text-muted)]">
            Page {page} of {totalPages}
          </span>

          {page < totalPages ? (
            <Link
              href={buildPageUrl(page + 1)}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-white px-3 py-2 text-sm font-medium transition-all active:scale-[0.98]"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  );
}
