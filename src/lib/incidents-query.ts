import type { IncidentStatus, IncidentUrgency, Prisma } from '@prisma/client';
import { activeIncidentStatuses } from './incident-status';

export type IncidentListFilter =
  | 'all'
  | 'mine'
  | 'all_open'
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'snoozed'
  | 'suppressed';
export type IncidentListSort = 'newest' | 'oldest' | 'updated' | 'status' | 'priority';

const incidentFilters: IncidentListFilter[] = [
  'all',
  'mine',
  'all_open',
  'open',
  'acknowledged',
  'resolved',
  'snoozed',
  'suppressed',
];

const incidentSorts: IncidentListSort[] = ['newest', 'oldest', 'updated', 'status', 'priority'];

export function normalizeIncidentFilter(value?: string): IncidentListFilter {
  if (value && incidentFilters.includes(value as IncidentListFilter)) {
    return value as IncidentListFilter;
  }
  return 'all';
}

export function normalizeIncidentSort(value?: string): IncidentListSort {
  if (value && incidentSorts.includes(value as IncidentListSort)) {
    return value as IncidentListSort;
  }
  return 'newest';
}

export function normalizeIncidentStatus(value?: string): IncidentStatus | undefined {
  if (
    value === 'OPEN' ||
    value === 'ACKNOWLEDGED' ||
    value === 'RESOLVED' ||
    value === 'SNOOZED' ||
    value === 'SUPPRESSED'
  ) {
    return value;
  }
  return undefined;
}

export function buildIncidentWhere({
  filter,
  search,
  priority,
  urgency,
  assigneeId,
  assignee,
  serviceId,
  status,
  createdAfter,
  createdBefore,
}: {
  filter: IncidentListFilter;
  search?: string;
  priority?: string;
  urgency?: string;
  assigneeId?: string | null;
  assignee?: string;
  serviceId?: string;
  status?: IncidentStatus;
  createdAfter?: Date;
  createdBefore?: Date;
}): Prisma.IncidentWhereInput {
  const where: Prisma.IncidentWhereInput = {};

  if (filter === 'mine') {
    where.assigneeId = assigneeId ?? undefined;
    where.status = { in: activeIncidentStatuses() };
  } else if (filter === 'all_open') {
    where.status = { in: activeIncidentStatuses() };
  } else if (filter === 'open') {
    where.status = 'OPEN';
  } else if (filter === 'acknowledged') {
    where.status = 'ACKNOWLEDGED';
  } else if (filter === 'resolved') {
    where.status = 'RESOLVED';
  } else if (filter === 'snoozed') {
    where.status = 'SNOOZED';
  } else if (filter === 'suppressed') {
    where.status = 'SUPPRESSED';
  }

  if (status && filter === 'all') {
    where.status = status;
  }

  if (assignee && filter !== 'mine') {
    where.assigneeId = assignee.toLowerCase() === 'unassigned' ? null : assignee;
  }

  if (serviceId) {
    where.serviceId = serviceId;
  }

  if (createdAfter || createdBefore) {
    where.createdAt = {
      ...(createdAfter ? { gte: createdAfter } : {}),
      ...(createdBefore ? { lte: createdBefore } : {}),
    };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { id: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (priority && priority !== 'all') {
    where.priority = priority;
  }

  if (urgency && urgency !== 'all') {
    const urgencyValue = urgency.toUpperCase() as IncidentUrgency;
    if (urgencyValue === 'LOW' || urgencyValue === 'MEDIUM' || urgencyValue === 'HIGH') {
      where.urgency = urgencyValue;
    }
  }

  return where;
}

export function buildIncidentOrderBy(
  sort: IncidentListSort
): Prisma.IncidentOrderByWithRelationInput[] {
  if (sort === 'oldest') {
    return [{ createdAt: 'asc' }];
  }
  if (sort === 'updated') {
    return [{ updatedAt: 'desc' }];
  }
  if (sort === 'status') {
    return [{ status: 'asc' }];
  }
  if (sort === 'priority') {
    return [{ priority: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
  }
  return [{ createdAt: 'desc' }];
}

export const incidentListSelect = {
  id: true,
  title: true,
  status: true,
  escalationStatus: true,
  currentEscalationStep: true,
  nextEscalationAt: true,
  priority: true,
  urgency: true,
  createdAt: true,
  assigneeId: true,
  teamId: true,
  service: {
    select: {
      id: true,
      name: true,
    },
  },
  team: {
    select: {
      id: true,
      name: true,
    },
  },
  assignee: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      gender: true,
    },
  },
} satisfies Prisma.IncidentSelect;
