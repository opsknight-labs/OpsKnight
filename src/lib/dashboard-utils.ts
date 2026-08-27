import { Prisma } from '@prisma/client';

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
  } = { includeStatus: true, includeUrgency: true }
): Prisma.IncidentWhereInput {
  const dateFilter = buildDateFilter(filters.range, filters.customStart, filters.customEnd);

  const where: Prisma.IncidentWhereInput = { ...dateFilter };

  if (options.includeStatus && filters.status && filters.status !== 'ALL') {
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

  if (options.includeUrgency && filters.urgency) {
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
