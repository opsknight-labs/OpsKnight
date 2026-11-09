import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { actorMetricReadScope, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { compileIncidentMetricFilter } from '@/lib/metrics/domain/filter';
import { logger } from '@/lib/logger';

/** A scoped reader sees at most this many services in the overview; beyond it the view says so. */
export const OVERVIEW_MAX_SERVICES = 2000;
/** Per-window cap on incidents sampled by the per-incident probes (first insight, change links). */
export const OVERVIEW_INCIDENT_SAMPLE_CAP = 5000;
/** Per-window cap on reviews sampled for acceptance rates. */
export const OVERVIEW_REVIEW_SAMPLE_CAP = 5000;
/** Statement budget for one overview section; a slow section fails on its own. */
export const OVERVIEW_SECTION_BUDGET = { maxDbMs: 4000 };

/**
 * What the viewer may read, resolved once per render. `serviceIds` is null for a global reader and the
 * readable service list (bounded) otherwise; `incidentSql` is the same incident visibility predicate the
 * analytics pages use (assigned, watching, or a public incident of one of the viewer's teams).
 */
export interface OverviewScope {
  actorId: string;
  global: boolean;
  serviceIds: string[] | null;
  servicesTruncated: boolean;
  incidentSql: (alias: string) => Prisma.Sql;
}

const NOTHING = Prisma.sql`AND false`;

export async function resolveOverviewScope(
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<OverviewScope> {
  let serviceWhere: Prisma.ServiceWhereInput | null;
  try {
    serviceWhere = serviceReadWhere(actor);
  } catch {
    serviceWhere = null;
  }
  let metricScope: ReturnType<typeof actorMetricReadScope> | null;
  try {
    metricScope = actorMetricReadScope(actor);
  } catch {
    metricScope = null;
  }
  const incidentSql = (alias: string) =>
    metricScope ? compileIncidentMetricFilter(metricScope, alias).sql : NOTHING;

  const servicesGlobal = serviceWhere !== null && Object.keys(serviceWhere).length === 0;
  const incidentsGlobal = metricScope !== null && !metricScope.authorizationScope;
  if (servicesGlobal && incidentsGlobal)
    return {
      actorId: actor.id,
      global: true,
      serviceIds: null,
      servicesTruncated: false,
      incidentSql,
    };

  let serviceIds: string[] = [];
  let servicesTruncated = false;
  if (serviceWhere) {
    try {
      const rows = await client.service.findMany({
        where: serviceWhere,
        orderBy: { id: 'asc' },
        take: OVERVIEW_MAX_SERVICES + 1,
        select: { id: true },
      });
      servicesTruncated = rows.length > OVERVIEW_MAX_SERVICES;
      serviceIds = rows.slice(0, OVERVIEW_MAX_SERVICES).map(row => row.id);
    } catch (error) {
      logger.warn('[Intelligence] Overview could not resolve readable services', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { actorId: actor.id, global: false, serviceIds, servicesTruncated, incidentSql };
}

/** Prisma filter on a `serviceId` column for the scope. */
export function serviceIdFilter(scope: OverviewScope): { serviceId?: { in: string[] } } {
  return scope.serviceIds === null ? {} : { serviceId: { in: scope.serviceIds } };
}

export type SectionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Runs one section's loader. A failure is logged with a fixed label and returned as a fixed message, so
 * one slow or broken probe degrades only its own card and nothing from the database reaches the page.
 */
export async function loadSection<T>(
  label: string,
  load: () => Promise<T>
): Promise<SectionResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    logger.warn(`[Intelligence] Overview section failed: ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: `The ${label} section could not be loaded. Try again shortly.` };
  }
}
