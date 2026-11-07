import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

export const ALERT_QUALITY_WINDOW_DAYS = 30;
export const QUICK_RESOLVE_SECONDS = 300;
/** Below this many incidents a ratio says nothing, so a service is not ranked. */
export const MIN_INCIDENTS_FOR_QUALITY = 5;
export const NOISY_THRESHOLD = 0.6;
const MAX_SERVICES = 2000;
const MAX_ROWS = 25;

export interface AlertQualityRow {
  serviceId: string;
  serviceName: string;
  incidents: number;
  /** Share of resolved incidents closed within five minutes, which usually means self-clearing noise. */
  quickResolvedRatio: number;
  /** Share of resolved incidents that nobody ever acknowledged. */
  neverAcknowledgedRatio: number;
  noiseScore: number;
  flagged: boolean;
}

export function scoreAlertQuality(input: {
  resolved: number;
  quickResolved: number;
  neverAcknowledged: number;
}): { quickResolvedRatio: number; neverAcknowledgedRatio: number; noiseScore: number } {
  if (input.resolved <= 0) return { quickResolvedRatio: 0, neverAcknowledgedRatio: 0, noiseScore: 0 };
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const quick = input.quickResolved / input.resolved;
  const never = input.neverAcknowledged / input.resolved;
  return { quickResolvedRatio: round(quick), neverAcknowledgedRatio: round(never), noiseScore: round((quick + never) / 2) };
}

/**
 * Services whose incidents look like noise, for the actor's visible services only. This only flags;
 * it never suppresses, mutes or changes anything. Services with too few incidents are not ranked.
 */
export async function getAlertQualityLeaderboard(
  actor: AuthorizationActor,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<AlertQualityRow[]> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ)) return [];
  let readable: Prisma.ServiceWhereInput;
  try {
    readable = serviceReadWhere(actor);
  } catch {
    return [];
  }
  const services = await client.service.findMany({ where: readable, take: MAX_SERVICES, select: { id: true, name: true } });
  if (services.length === 0) return [];
  const names = new Map(services.map(service => [service.id, service.name]));
  const since = new Date(now.getTime() - ALERT_QUALITY_WINDOW_DAYS * 86_400_000);

  const rows = await client.$queryRaw<
    Array<{ serviceId: string; incidents: number; resolved: number; quick: number; never: number }>
  >(Prisma.sql`
    SELECT "serviceId",
           count(*)::int AS incidents,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL)::int AS resolved,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL
             AND "resolvedAt" - "createdAt" <= make_interval(secs => ${QUICK_RESOLVE_SECONDS}::float))::int AS quick,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL AND "acknowledgedAt" IS NULL)::int AS never
    FROM "Incident"
    WHERE "createdAt" >= ${since} AND "serviceId" = ANY(${[...names.keys()]})
    GROUP BY "serviceId"
    HAVING count(*) >= ${MIN_INCIDENTS_FOR_QUALITY}
  `);

  return rows
    .map(row => {
      const score = scoreAlertQuality({ resolved: row.resolved, quickResolved: row.quick, neverAcknowledged: row.never });
      return {
        serviceId: row.serviceId,
        serviceName: names.get(row.serviceId) ?? row.serviceId,
        incidents: row.incidents,
        ...score,
        flagged: score.noiseScore >= NOISY_THRESHOLD,
      };
    })
    .sort((a, b) => b.noiseScore - a.noiseScore || b.incidents - a.incidents || a.serviceId.localeCompare(b.serviceId))
    .slice(0, MAX_ROWS);
}
