import 'server-only';

import type { AuthorizationActor } from '@/lib/authorization-policy';
import { actorMetricReadScope, incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { getServiceDynamicStatus } from '@/lib/service-status';
import { getExternalStatusLabel } from '@/lib/sla-server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type InternalOperationalStatusSnapshot = {
  name: string;
  overallStatus: string;
  services: Array<{
    id: string;
    name: string;
    status: string;
    incidentCount: number;
    criticalCount: number;
  }>;
  counts: {
    operational: number;
    degraded: number;
    major: number;
    activeIncidents: number;
    criticalIncidents: number;
  };
  activeIncidents: Array<{
    id: string;
    title: string;
    status: string;
    urgency: string;
    serviceName: string;
    createdAt: Date;
  }>;
  announcements: Array<{
    id: string;
    title: string;
    type: string;
    message: string;
    startDate: Date;
    endDate: Date | null;
  }>;
  recentHistory: Array<{
    id: string;
    title: string;
    urgency: string;
    serviceName: string;
    resolvedAt: Date;
  }>;
  generatedAt: Date;
  sourceGeneration: string | null;
  freshness: 'fresh' | 'stale';
};

type CacheEntry = Omit<InternalOperationalStatusSnapshot, 'freshness'> & {
  freshUntil: number;
  staleUntil: number;
};

const FRESH_TTL_MS = 20_000;
const STALE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 300;
const MAX_CONCURRENT_CALCULATIONS = 4;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();
let activeCalculations = 0;

function scopeKey(actor: AuthorizationActor) {
  const authorizationScope = actorMetricReadScope(actor).authorizationScope;
  return JSON.stringify(
    authorizationScope
      ? {
          actorId: authorizationScope.actorId,
          teams: [...authorizationScope.teamIds].sort(),
          projection: 'internal-operational-status-v1',
        }
      : { scope: 'global', projection: 'internal-operational-status-v1' }
  );
}

function prune(now: number) {
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

async function calculate(key: string, actor: AuthorizationActor): Promise<CacheEntry> {
  activeCalculations += 1;
  const startedAt = Date.now();
  try {
    const now = new Date();
    const incidentScope = incidentReadWhere(actor);
    const activeWhere = {
      AND: [incidentScope, { status: { in: activeIncidentStatuses() } }],
    } as const;

    const [statusPage, services, activeGroups, activeIncidents, recentHistory, sourceGeneration] =
      await Promise.all([
        prisma.statusPage.findFirst({
          where: { enabled: true },
          select: {
            name: true,
            announcements: {
              where: {
                isActive: true,
                OR: [{ endDate: null }, { endDate: { gte: now } }],
              },
              orderBy: { startDate: 'desc' },
              take: 5,
              select: {
                id: true,
                title: true,
                type: true,
                message: true,
                startDate: true,
                endDate: true,
              },
            },
          },
        }),
        prisma.service.findMany({
          where: serviceReadWhere(actor),
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        prisma.incident.groupBy({
          by: ['serviceId', 'urgency'],
          where: activeWhere,
          _count: { id: true },
        }),
        prisma.incident.findMany({
          where: activeWhere,
          orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }],
          take: 10,
          select: {
            id: true,
            title: true,
            status: true,
            urgency: true,
            createdAt: true,
            service: { select: { name: true } },
          },
        }),
        prisma.incident.findMany({
          where: { AND: [incidentScope, { status: 'RESOLVED', resolvedAt: { not: null } }] },
          orderBy: { resolvedAt: 'desc' },
          take: 8,
          select: {
            id: true,
            title: true,
            urgency: true,
            resolvedAt: true,
            service: { select: { name: true } },
          },
        }),
        getRealtimeChangeGeneration().catch(() => null),
      ]);

    const countsByService = new Map<string, { active: number; critical: number }>();
    for (const group of activeGroups) {
      const counts = countsByService.get(group.serviceId) ?? { active: 0, critical: 0 };
      counts.active += group._count.id;
      if (group.urgency === 'HIGH') counts.critical += group._count.id;
      countsByService.set(group.serviceId, counts);
    }

    const serviceStatuses = services.map(service => {
      const counts = countsByService.get(service.id) ?? { active: 0, critical: 0 };
      const dynamicStatus = getServiceDynamicStatus({
        activeIncidentCount: counts.active,
        hasCritical: counts.critical > 0,
      });
      return {
        id: service.id,
        name: service.name,
        status: getExternalStatusLabel(dynamicStatus),
        incidentCount: counts.active,
        criticalCount: counts.critical,
      };
    });

    const operational = serviceStatuses.filter(service => service.status === 'OPERATIONAL').length;
    const degraded = serviceStatuses.filter(service => service.status === 'PARTIAL_OUTAGE').length;
    const major = serviceStatuses.filter(service => service.status === 'MAJOR_OUTAGE').length;
    const activeIncidentCount = activeGroups.reduce((sum, group) => sum + group._count.id, 0);
    const criticalIncidentCount = activeGroups
      .filter(group => group.urgency === 'HIGH')
      .reduce((sum, group) => sum + group._count.id, 0);
    const overallStatus = getExternalStatusLabel(
      getServiceDynamicStatus({
        activeIncidentCount,
        hasCritical: criticalIncidentCount > 0,
      })
    );

    const generatedAt = new Date();
    const entry: CacheEntry = {
      name: statusPage?.name || 'System health',
      overallStatus,
      services: serviceStatuses,
      counts: {
        operational,
        degraded,
        major,
        activeIncidents: activeIncidentCount,
        criticalIncidents: criticalIncidentCount,
      },
      activeIncidents: activeIncidents.map(incident => ({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        urgency: incident.urgency,
        serviceName: incident.service.name,
        createdAt: incident.createdAt,
      })),
      announcements: statusPage?.announcements ?? [],
      recentHistory: recentHistory
        .filter((incident): incident is typeof incident & { resolvedAt: Date } => Boolean(incident.resolvedAt))
        .map(incident => ({
          id: incident.id,
          title: incident.title,
          urgency: incident.urgency,
          serviceName: incident.service.name,
          resolvedAt: incident.resolvedAt,
        })),
      generatedAt,
      sourceGeneration,
      freshUntil: generatedAt.getTime() + FRESH_TTL_MS,
      staleUntil: generatedAt.getTime() + STALE_TTL_MS,
    };

    cache.delete(key);
    cache.set(key, entry);
    return entry;
  } catch (error) {
    logger.error('status.internalSnapshot.calculate_failed', {
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  } finally {
    activeCalculations = Math.max(0, activeCalculations - 1);
  }
}

function startCalculation(key: string, actor: AuthorizationActor) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (activeCalculations >= MAX_CONCURRENT_CALCULATIONS) return null;
  const request = calculate(key, actor).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

function project(entry: CacheEntry, freshness: 'fresh' | 'stale'): InternalOperationalStatusSnapshot {
  return {
    name: entry.name,
    overallStatus: entry.overallStatus,
    services: entry.services,
    counts: entry.counts,
    activeIncidents: entry.activeIncidents,
    announcements: entry.announcements,
    recentHistory: entry.recentHistory,
    generatedAt: entry.generatedAt,
    sourceGeneration: entry.sourceGeneration,
    freshness,
  };
}

export async function getInternalOperationalStatusSnapshot(
  actor: AuthorizationActor
): Promise<InternalOperationalStatusSnapshot> {
  const now = Date.now();
  prune(now);
  const key = scopeKey(actor);
  const entry = cache.get(key);
  const currentGeneration = entry ? await getRealtimeChangeGeneration().catch(() => null) : null;
  const generationChanged = Boolean(
    entry && currentGeneration && currentGeneration !== entry.sourceGeneration
  );

  if (entry && entry.freshUntil > now && !generationChanged) return project(entry, 'fresh');

  if (entry && entry.staleUntil > now) {
    const refresh = startCalculation(key, actor);
    if (refresh) void refresh.catch(() => undefined);
    return project(entry, 'stale');
  }

  const request = startCalculation(key, actor);
  if (!request) throw new Error('Operational status is temporarily busy');
  return project(await request, 'fresh');
}

export function resetInternalOperationalStatusCacheForTests() {
  cache.clear();
  inFlight.clear();
  activeCalculations = 0;
}
