import { Prisma } from '@prisma/client';
import { getQueryDateBounds, getReportingWindowForDays } from './retention-policy';

// Type for filter parameters
export interface DashboardFilters {
  status?: string;
  service?: string;
  assignee?: string;
  urgency?: string;
  search?: string;
  range?: string;
  customStart?: string;
  customEnd?: string;
}

// Type for date range
interface DateFilter {
  gte?: Date;
  lte?: Date;
}

type IncidentDateWhere = Pick<Prisma.IncidentWhereInput, 'createdAt'>;

export interface RetainedDateFilterResult {
  where: IncidentDateWhere;
  window: {
    start: Date;
    end: Date;
    isClipped: boolean;
  };
}

export async function buildRetainedDateFilter(
  range?: string,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date()
): Promise<RetainedDateFilterResult> {
  let bounds;
  if (range === 'custom') {
    const requestedStart = customStart ? new Date(customStart) : undefined;
    const requestedEnd = customEnd ? new Date(customEnd) : undefined;
    bounds = await getQueryDateBounds(requestedStart, requestedEnd, 'incident', now);
  } else if (!range || range === 'all') {
    bounds = await getQueryDateBounds(undefined, now, 'incident', now);
  } else {
    const days = Number.parseInt(range, 10);
    bounds = Number.isFinite(days)
      ? await getReportingWindowForDays(days, 'incident', now)
      : await getReportingWindowForDays(30, 'incident', now);
  }
  return {
    where: { createdAt: { gte: bounds.start, lte: bounds.end } },
    window: {
      start: bounds.start,
      end: bounds.end,
      isClipped: bounds.isClipped,
    },
  };
}

/**
 * Build date filter based on range parameters
 */
export function buildDateFilter(
  range?: string,
  customStart?: string,
  customEnd?: string
): { createdAt?: DateFilter } {
  if (!range || range === 'all') {
    return {};
  }

  if (range === 'custom' && customStart && customEnd) {
    return {
      createdAt: {
        gte: new Date(customStart),
        lte: new Date(customEnd),
      },
    };
  }

  const days = parseInt(range);
  if (!isNaN(days)) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    return {
      createdAt: {
        gte: startDate,
      },
    };
  }

  return {};
}

/**
 * Build incident where clause for dashboard queries
 */
export function buildIncidentWhere(
  filters: DashboardFilters,
  options: {
    includeStatus?: boolean;
    includeUrgency?: boolean;
    dateFilter?: IncidentDateWhere;
  } = {}
): Prisma.IncidentWhereInput {
  const includeStatus = options.includeStatus ?? true;
  const includeUrgency = options.includeUrgency ?? true;
  const dateFilter =
    options.dateFilter ?? buildDateFilter(filters.range, filters.customStart, filters.customEnd);

  // Copy only the Prisma field we explicitly support. TypeScript permits values
  // with additional properties to satisfy IncidentDateWhere, so spreading the
  // caller object would let retention metadata leak back into a Prisma query.
  const where: Prisma.IncidentWhereInput = dateFilter.createdAt
    ? { createdAt: dateFilter.createdAt }
    : {};

  if (includeStatus && filters.status && filters.status !== 'ALL') {
    where.status =
      filters.status === 'ACTIVE'
        ? { in: ['OPEN', 'ACKNOWLEDGED'] }
        : (filters.status as Prisma.EnumIncidentStatusFilter);
  }

  if (filters.assignee !== undefined) {
    where.assigneeId = filters.assignee === '' ? null : filters.assignee;
  }

  if (filters.service) {
    where.serviceId = filters.service;
  }

  if (includeUrgency && filters.urgency) {
    where.urgency = filters.urgency as Prisma.EnumIncidentUrgencyFilter;
  }

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
      { id: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/**
 * Build orderBy clause for incidents
 */
export function buildIncidentOrderBy(
  sortBy?: string,
  sortOrder: 'asc' | 'desc' = 'desc'
): Prisma.IncidentOrderByWithRelationInput {
  switch (sortBy) {
    case 'status':
      return { status: sortOrder };
    case 'urgency':
      return { urgency: sortOrder };
    case 'title':
      return { title: sortOrder };
    case 'createdAt':
    default:
      return { createdAt: sortOrder };
  }
}

/**
 * Get number of days from range string
 */
export function getDaysFromRange(range?: string): number {
  if (!range || range === 'all') return 30;
  const days = parseInt(range);
  return isNaN(days) ? 30 : days;
}

/**
 * Get human-readable range label
 */
export function getRangeLabel(range?: string): string {
  if (!range || range === 'all') return '(All Time)';
  if (range === 'custom') return '(Custom)';
  if (range === '3') return '(3d)';
  if (range === '7') return '(7d)';
  if (range === '30') return '(30d)';
  if (range === '90') return '(90d)';
  return '(30d)';
}
