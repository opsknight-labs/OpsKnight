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
  teamId: string | null;
  teamName: string | null;
  incidents: number;
  /** Share of resolved incidents closed within five minutes, which usually means self-clearing noise. */
  quickResolvedRatio: number;
  /** Share of resolved incidents that nobody ever acknowledged. */
  neverAcknowledgedRatio: number;
  /** Share of incidents the flapping detector opened as suppressed. */
  flappingRatio: number;
  noiseScore: number;
  flagged: boolean;
}

export interface TeamAlertQuality {
  teamId: string | null;
  teamName: string;
  services: number;
  flaggedServices: number;
  incidents: number;
  noiseScore: number;
}

export function scoreAlertQuality(input: {
  resolved: number;
  quickResolved: number;
  neverAcknowledged: number;
  flapping?: number;
  total?: number;
}): {
  quickResolvedRatio: number;
  neverAcknowledgedRatio: number;
  flappingRatio: number;
  noiseScore: number;
} {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const total = Math.max(input.total ?? input.resolved, 0);
  const flapping = total > 0 ? Math.max(0, input.flapping ?? 0) / total : 0;
  if (input.resolved <= 0)
    return {
      quickResolvedRatio: 0,
      neverAcknowledgedRatio: 0,
      flappingRatio: round(flapping),
      noiseScore: round(flapping),
    };
  const quick = input.quickResolved / input.resolved;
  const never = input.neverAcknowledged / input.resolved;
  // Flapping is already a strong noise signal on its own, so it enters with full weight alongside the two
  // resolution-based ratios.
  return {
    quickResolvedRatio: round(quick),
    neverAcknowledgedRatio: round(never),
    flappingRatio: round(flapping),
    noiseScore: round(Math.max((quick + never) / 2, flapping)),
  };
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
  const services = await client.service.findMany({
    where: readable,
    take: MAX_SERVICES,
    select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
  });
  if (services.length === 0) return [];
  const byId = new Map(services.map(service => [service.id, service]));
  const since = new Date(now.getTime() - ALERT_QUALITY_WINDOW_DAYS * 86_400_000);

  const rows = await client.$queryRaw<
    Array<{
      serviceId: string;
      incidents: number;
      resolved: number;
      quick: number;
      never: number;
      flapping: number;
    }>
  >(Prisma.sql`
    SELECT "serviceId",
           count(*)::int AS incidents,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL)::int AS resolved,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL
             AND "resolvedAt" - "createdAt" <= make_interval(secs => ${QUICK_RESOLVE_SECONDS}::float))::int AS quick,
           count(*) FILTER (WHERE "resolvedAt" IS NOT NULL AND "acknowledgedAt" IS NULL)::int AS never,
           count(*) FILTER (WHERE "status" = 'SUPPRESSED')::int AS flapping
    FROM "Incident"
    WHERE "createdAt" >= ${since} AND "serviceId" = ANY(${[...byId.keys()]})
    GROUP BY "serviceId"
    HAVING count(*) >= ${MIN_INCIDENTS_FOR_QUALITY}
  `);

  return rows
    .map(row => {
      const service = byId.get(row.serviceId);
      const score = scoreAlertQuality({
        resolved: row.resolved,
        quickResolved: row.quick,
        neverAcknowledged: row.never,
        flapping: row.flapping,
        total: row.incidents,
      });
      return {
        serviceId: row.serviceId,
        serviceName: service?.name ?? row.serviceId,
        teamId: service?.teamId ?? null,
        teamName: service?.team?.name ?? null,
        incidents: row.incidents,
        ...score,
        flagged: score.noiseScore >= NOISY_THRESHOLD,
      };
    })
    .sort(
      (a, b) =>
        b.noiseScore - a.noiseScore ||
        b.incidents - a.incidents ||
        a.serviceId.localeCompare(b.serviceId)
    )
    .slice(0, MAX_ROWS);
}

/** The leaderboard rolled up by owning team, noisiest teams first; services without a team form one group. */
export function summarizeAlertQualityByTeam(rows: readonly AlertQualityRow[]): TeamAlertQuality[] {
  const teams = new Map<string, TeamAlertQuality & { weighted: number }>();
  for (const row of rows) {
    const key = row.teamId ?? '';
    const entry = teams.get(key) ?? {
      teamId: row.teamId,
      teamName: row.teamName ?? 'No team',
      services: 0,
      flaggedServices: 0,
      incidents: 0,
      noiseScore: 0,
      weighted: 0,
    };
    entry.services += 1;
    entry.flaggedServices += row.flagged ? 1 : 0;
    entry.incidents += row.incidents;
    entry.weighted += row.noiseScore * row.incidents;
    teams.set(key, entry);
  }
  return [...teams.values()]
    .map(({ weighted, ...team }) => ({
      ...team,
      noiseScore: team.incidents > 0 ? Math.round((weighted / team.incidents) * 1000) / 1000 : 0,
    }))
    .sort(
      (a, b) =>
        b.noiseScore - a.noiseScore ||
        b.incidents - a.incidents ||
        a.teamName.localeCompare(b.teamName)
    );
}
