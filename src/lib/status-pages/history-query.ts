import 'server-only';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export const HISTORY_INCIDENT_PAGE_SIZE = 1_000;

export type HistoryIncident = {
  id: string;
  serviceId: string;
  createdAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
  urgency: string;
  status: string;
};

/** Reads the complete window in bounded pages or rejects without returning partial history. */
export async function loadHistoryIncidentsByService(
  serviceIds: string[],
  earliestRequiredStart: Date,
  now: Date,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Map<string, HistoryIncident[]>> {
  const byService = new Map<string, HistoryIncident[]>();
  let cursor: string | undefined;

  while (true) {
    const page = await db.incident.findMany({
      where: {
        serviceId: { in: serviceIds },
        visibility: 'PUBLIC',
        status: { notIn: ['SUPPRESSED', 'SNOOZED'] },
        createdAt: { lt: now },
        OR: [
          { resolvedAt: { gte: earliestRequiredStart } },
          { resolvedAt: null, status: { not: 'RESOLVED' } },
          { resolvedAt: null, status: 'RESOLVED', updatedAt: { gte: earliestRequiredStart } },
        ],
      },
      orderBy: { id: 'asc' },
      take: HISTORY_INCIDENT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        serviceId: true,
        createdAt: true,
        resolvedAt: true,
        updatedAt: true,
        urgency: true,
        status: true,
      },
    });

    for (const incident of page) {
      const serviceIncidents = byService.get(incident.serviceId) ?? [];
      serviceIncidents.push(incident);
      byService.set(incident.serviceId, serviceIncidents);
    }
    if (page.length < HISTORY_INCIDENT_PAGE_SIZE) return byService;
    cursor = page.at(-1)?.id;
    if (!cursor) throw new Error('Status history pagination did not advance');
  }
}

const CURRENT_INCIDENT_SELECT = {
  id: true,
  serviceId: true,
  createdAt: true,
  resolvedAt: true,
  updatedAt: true,
  urgency: true,
  status: true,
} as const;

/** Active public incidents only — enough for current health without scanning history. */
export async function loadCurrentIncidentsByService(
  serviceIds: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Map<string, HistoryIncident[]>> {
  const byService = new Map<string, HistoryIncident[]>();
  if (serviceIds.length === 0) return byService;
  const rows = await db.incident.findMany({
    where: {
      serviceId: { in: serviceIds },
      visibility: 'PUBLIC',
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    },
    select: CURRENT_INCIDENT_SELECT,
  });
  for (const incident of rows) {
    const serviceIncidents = byService.get(incident.serviceId) ?? [];
    serviceIncidents.push(incident);
    byService.set(incident.serviceId, serviceIncidents);
  }
  return byService;
}
