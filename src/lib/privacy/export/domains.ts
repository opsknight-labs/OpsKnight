import 'server-only';

import prisma from '@/lib/prisma';

/**
 * Each fetcher selects an explicit, hand-picked column allowlist. Never widen
 * these with `include`/spread — a new sensitive column added to a model must
 * be deliberately opted into an export, not inherited automatically.
 */

/** High-volume domains (notifications, audit events) must never be silently
 * truncated without saying so. This bounds worst-case export time/memory
 * while still reporting the true total and whether the export is partial. */
const EXPORT_DOMAIN_HARD_CAP = 20_000;
const EXPORT_PAGE_SIZE = 1000;

export interface PaginatedDomainResult<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

async function fetchAllPaginated<T extends { id: string }>(
  fetchPage: (cursor: string | undefined, take: number) => Promise<T[]>,
  totalCount: number,
  hardCap: number = EXPORT_DOMAIN_HARD_CAP
): Promise<PaginatedDomainResult<T>> {
  const items: T[] = [];
  const limit = Math.min(totalCount, hardCap);
  let cursor: string | undefined;

  while (items.length < limit) {
    const take = Math.min(EXPORT_PAGE_SIZE, limit - items.length);
    const page = await fetchPage(cursor, take);
    if (page.length === 0) break;
    items.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < take) break;
  }

  return { items, totalCount, truncated: totalCount > items.length };
}

export async function fetchProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      timeZone: true,
      phoneNumber: true,
      department: true,
      jobTitle: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      pushNotificationsEnabled: true,
      whatsappNotificationsEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function fetchIdentities(userId: string) {
  return prisma.oidcIdentity.findMany({
    where: { userId },
    select: {
      id: true,
      issuer: true,
      email: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}

export async function fetchMemberships(userId: string) {
  return prisma.teamMember.findMany({
    where: { userId },
    select: {
      id: true,
      role: true,
      team: { select: { id: true, name: true } },
    },
  });
}

export async function fetchIncidents(userId: string) {
  return prisma.incident.findMany({
    where: { assigneeId: userId },
    select: {
      id: true,
      title: true,
      status: true,
      urgency: true,
      priority: true,
      createdAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      service: { select: { id: true, name: true } },
    },
  });
}

export async function fetchIncidentNotes(userId: string) {
  return prisma.incidentNote.findMany({
    where: { userId },
    select: {
      id: true,
      incidentId: true,
      content: true,
      createdAt: true,
    },
  });
}

export async function fetchSchedules(userId: string) {
  const [shifts, overrides] = await Promise.all([
    prisma.onCallShift.findMany({
      where: { userId },
      select: {
        id: true,
        start: true,
        end: true,
        schedule: { select: { id: true, name: true } },
      },
    }),
    prisma.onCallOverride.findMany({
      where: { userId },
      select: {
        id: true,
        start: true,
        end: true,
        schedule: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { shifts, overrides };
}

export async function fetchNotifications(userId: string) {
  const totalCount = await prisma.notification.count({ where: { userId } });
  return fetchAllPaginated(
    (cursor, take) =>
      prisma.notification.findMany({
        where: { userId },
        select: {
          id: true,
          incidentId: true,
          channel: true,
          status: true,
          category: true,
          scheduledAt: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
        },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    totalCount
  );
}

/** Only action/entity metadata — never the `details` blob, which may reference other subjects. */
export async function fetchAuditEvents(userId: string) {
  const where = { OR: [{ actorId: userId }, { entityType: 'USER' as const, entityId: userId }] };
  const totalCount = await prisma.auditLog.count({ where });
  return fetchAllPaginated(
    (cursor, take) =>
      prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    totalCount
  );
}
