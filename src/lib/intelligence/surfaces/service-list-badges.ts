import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import {
  BURN_WINDOWS_MINUTES,
  burnRate,
  classifyBurn,
  mergedDowntimeMinutes,
  type BurnSeverity,
  type Interval,
} from '@/lib/slo/burn';
import { GLOBAL_NOISE_SCOPE_KEY, noiseScopeKey } from '../noise-controls/contract';
import { isWindowActiveAt } from '../noise-controls/recurrence';

/**
 * Optional intelligence badges for one page of the service list: maintenance active, SLO burning and
 * noise controls ON/SHADOW. A fixed number of queries for the whole page, never one per row: one to
 * re-check which of the page's services the viewer may read, then one per badge kind (the SLO badge
 * needs its objectives and the incidents overlapping the burn window, so two).
 *
 * A service with nothing to say gets no entry, so the list renders no empty badge.
 */

export interface ServiceListBadges {
  /** A service-, team- or organisation-wide maintenance window is active right now. */
  maintenance?: { name: string; endsAt: string };
  sloBurning?: Exclude<BurnSeverity, 'none'>;
  noiseMode?: 'ON' | 'SHADOW';
}

export const SERVICE_LIST_BADGE_LIMITS = {
  maxIds: 100,
  maxWindows: 200,
  maxObjectives: 500,
  maxIncidents: 2000,
} as const;

export async function getServiceListBadges(
  serviceIds: readonly string[],
  actor: AuthorizationActor,
  options: { now?: Date } = {},
  client: typeof prisma = prisma
): Promise<Record<string, ServiceListBadges>> {
  const requested = [...new Set(serviceIds)].slice(0, SERVICE_LIST_BADGE_LIMITS.maxIds);
  if (!requested.length || actor.status !== 'ACTIVE') return {};
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return {};
  let readable: Prisma.ServiceWhereInput;
  try {
    readable = serviceReadWhere(actor);
  } catch {
    return {};
  }
  const now = options.now ?? new Date();
  try {
    const services = await client.service.findMany({
      where: { AND: [{ id: { in: requested } }, readable] },
      take: requested.length,
      select: { id: true, teamId: true },
    });
    if (!services.length) return {};
    const ids = services.map(service => service.id);
    const teamIds = [
      ...new Set(services.map(s => s.teamId).filter((id): id is string => Boolean(id))),
    ];
    const end = now.getTime();
    const slowStart = new Date(end - BURN_WINDOWS_MINUTES.slow * 60_000);

    const [policies, windows, objectives] = await Promise.all([
      client.noiseControlPolicy.findMany({
        where: { scopeKey: { in: [GLOBAL_NOISE_SCOPE_KEY, ...ids.map(id => noiseScopeKey(id))] } },
        take: ids.length + 1,
        select: { scopeKey: true, mode: true },
      }),
      client.noiseMaintenanceWindow.findMany({
        where: {
          enabled: true,
          endedAt: null,
          startsAt: { lte: now },
          AND: [
            {
              OR: [
                { scope: 'SERVICE', serviceId: { in: ids } },
                ...(teamIds.length ? [{ scope: 'TEAM' as const, teamId: { in: teamIds } }] : []),
                { scope: 'ALL' },
              ],
            },
            { OR: [{ recurrence: { not: null } }, { endsAt: { gte: now } }] },
          ],
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: SERVICE_LIST_BADGE_LIMITS.maxWindows,
        select: {
          name: true,
          scope: true,
          serviceId: true,
          teamId: true,
          startsAt: true,
          endsAt: true,
          recurrence: true,
        },
      }),
      client.serviceObjective.findMany({
        where: {
          serviceId: { in: ids },
          metricType: { in: ['UPTIME', 'AVAILABILITY'] },
          activeFrom: { lte: now },
          OR: [{ activeTo: null }, { activeTo: { gt: now } }],
        },
        take: SERVICE_LIST_BADGE_LIMITS.maxObjectives,
        select: { serviceId: true, target: true },
      }),
    ]);

    const found = new Map<string, ServiceListBadges>();
    const entry = (id: string) => {
      let badges = found.get(id);
      if (!badges) found.set(id, (badges = {}));
      return badges;
    };

    // Noise controls: a service's own row wins over the global row (an explicit OFF stays off).
    const modeByScope = new Map(policies.map(row => [row.scopeKey, row.mode]));
    const globalMode = modeByScope.get(GLOBAL_NOISE_SCOPE_KEY) ?? 'OFF';
    for (const id of ids) {
      const mode = modeByScope.get(noiseScopeKey(id)) ?? globalMode;
      if (mode === 'ON' || mode === 'SHADOW') entry(id).noiseMode = mode;
    }

    // Maintenance: the first window active now that covers the service.
    const activeWindows = windows.filter(window => {
      try {
        return isWindowActiveAt(window, now);
      } catch {
        return false;
      }
    });
    for (const service of services) {
      const window = activeWindows.find(
        w =>
          w.scope === 'ALL' ||
          (w.scope === 'SERVICE' && w.serviceId === service.id) ||
          (w.scope === 'TEAM' && w.teamId !== null && w.teamId === service.teamId)
      );
      if (window)
        entry(service.id).maintenance = {
          name: window.name,
          endsAt: window.endsAt.toISOString(),
        };
    }

    // SLO burn: only services that have an availability objective cost the incident query.
    const withObjective = [...new Set(objectives.map(o => o.serviceId!).filter(Boolean))];
    if (withObjective.length) {
      const incidents = await client.incident.findMany({
        where: {
          serviceId: { in: withObjective },
          createdAt: { lte: now },
          OR: [{ resolvedAt: null }, { resolvedAt: { gte: slowStart } }],
          status: { not: 'SUPPRESSED' },
        },
        orderBy: { createdAt: 'desc' },
        take: SERVICE_LIST_BADGE_LIMITS.maxIncidents,
        select: { serviceId: true, createdAt: true, resolvedAt: true },
      });
      const intervals = new Map<string, Interval[]>();
      for (const incident of incidents) {
        const list = intervals.get(incident.serviceId) ?? [];
        list.push({
          start: incident.createdAt.getTime(),
          end: incident.resolvedAt?.getTime() ?? end,
        });
        intervals.set(incident.serviceId, list);
      }
      const fastStart = end - BURN_WINDOWS_MINUTES.fast * 60_000;
      for (const serviceId of withObjective) {
        const own = intervals.get(serviceId);
        if (!own) continue;
        const fast = mergedDowntimeMinutes(own, fastStart, end);
        const slow = mergedDowntimeMinutes(own, slowStart.getTime(), end);
        let worst: BurnSeverity = 'none';
        for (const objective of objectives) {
          if (objective.serviceId !== serviceId) continue;
          const severity = classifyBurn(
            burnRate(fast, BURN_WINDOWS_MINUTES.fast, objective.target),
            burnRate(slow, BURN_WINDOWS_MINUTES.slow, objective.target)
          );
          if (severity === 'critical') worst = 'critical';
          else if (severity === 'warning' && worst === 'none') worst = 'warning';
        }
        if (worst !== 'none') entry(serviceId).sloBurning = worst;
      }
    }
    return Object.fromEntries(found);
  } catch (error) {
    logger.warn('[Intelligence] Service list badges unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
