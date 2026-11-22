import 'server-only';

import type { BusinessServiceTier } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { businessServiceReadWhere } from './commands';
import { getBusinessServiceStats, type BusinessServiceStats, type TimeWindow } from './contract';
import { unionDurationMs } from './stats';

export const IMPACT_REPORT_WINDOWS = [7, 30, 90] as const;
const TIERS: readonly BusinessServiceTier[] = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'];
/** shortcut: one engine stats call per business service; above this, filter by team or tier. */
export const IMPACT_REPORT_LIMIT = 100;
const CONCURRENCY = 8;
const MAX_IMPACT_ROWS = 10_000;

export type ImpactReportParams = {
  days: (typeof IMPACT_REPORT_WINDOWS)[number];
  teamId: string | null;
  tier: BusinessServiceTier | null;
};

export type ImpactReportRow = {
  id: string;
  name: string;
  criticality: BusinessServiceTier | null;
  ownerTeam: { id: string; name: string } | null;
  stats: BusinessServiceStats;
  /** The member service whose own incidents caused the most impact time in the window. */
  worstMember: { id: string; name: string; impactMinutes: number } | null;
};

export type ImpactReport = {
  window: TimeWindow;
  params: ImpactReportParams;
  rows: ImpactReportRow[];
  truncated: boolean;
};

const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);

export function parseImpactReportParams(
  raw: Record<string, unknown> | URLSearchParams | undefined
): ImpactReportParams {
  const search =
    raw instanceof URLSearchParams
      ? raw
      : new URLSearchParams(
          Object.entries(raw ?? {}).flatMap(([key, value]) =>
            typeof one(value) === 'string' ? [[key, one(value) as string]] : []
          )
        );
  const get = (key: string) => search.get(key);
  const days = Number(get('days'));
  const team = get('team');
  const tier = get('tier');
  return {
    days: IMPACT_REPORT_WINDOWS.find(value => value === days) ?? 30,
    teamId: typeof team === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(team) ? team : null,
    tier: TIERS.find(value => value === tier) ?? null,
  };
}

export function impactReportSearch(params: ImpactReportParams): string {
  const search = new URLSearchParams();
  if (params.days !== 30) search.set('days', String(params.days));
  if (params.teamId) search.set('team', params.teamId);
  if (params.tier) search.set('tier', params.tier);
  return search.toString();
}

/**
 * Per business service the actor can see: uptime, incidents, MTTA/MTTR and impacted time from the
 * engine stats (union of impact intervals), plus the member that caused the most impact.
 * Worst impact first.
 */
export async function getBusinessImpactReport(
  actor: AuthorizationActor,
  params: ImpactReportParams,
  now = new Date()
): Promise<ImpactReport> {
  const window = { from: new Date(now.getTime() - params.days * 86_400_000), to: now };
  const found = await prisma.businessService.findMany({
    where: {
      AND: [
        businessServiceReadWhere(actor),
        params.teamId ? { ownerTeamId: params.teamId } : {},
        params.tier ? { criticality: params.tier } : {},
      ],
    },
    orderBy: [{ criticality: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    take: IMPACT_REPORT_LIMIT + 1,
    select: {
      id: true,
      name: true,
      criticality: true,
      ownerTeam: { select: { id: true, name: true } },
      members: { select: { serviceId: true } },
    },
  });
  const services = found.slice(0, IMPACT_REPORT_LIMIT);
  const stats: BusinessServiceStats[] = [];
  for (let index = 0; index < services.length; index += CONCURRENCY) {
    stats.push(
      ...(await Promise.all(
        services
          .slice(index, index + CONCURRENCY)
          .map(service => getBusinessServiceStats(service.id, window, actor))
      ))
    );
  }
  const worst = await worstMembers(actor, services, window, now);
  const rows = services.map((service, index) => ({
    stats: stats.at(index)!,
    id: service.id,
    name: service.name,
    criticality: service.criticality,
    ownerTeam: service.ownerTeam,
    worstMember: worst.get(service.id) ?? null,
  }));
  rows.sort(
    (a, b) =>
      b.stats.impactMinutes - a.stats.impactMinutes ||
      b.stats.incidentCount - a.stats.incidentCount ||
      a.name.localeCompare(b.name)
  );
  return { window, params, rows, truncated: found.length > IMPACT_REPORT_LIMIT };
}

async function worstMembers(
  actor: AuthorizationActor,
  services: ReadonlyArray<{ id: string; members: ReadonlyArray<{ serviceId: string }> }>,
  window: TimeWindow,
  now: Date
) {
  const result = new Map<string, { id: string; name: string; impactMinutes: number }>();
  if (services.length === 0) return result;
  const rows = await prisma.incidentBusinessServiceImpact.findMany({
    where: {
      businessServiceId: { in: services.map(service => service.id) },
      excluded: false,
      startedAt: { lt: window.to },
      OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
      // Only members the reader may see are ever named.
      incident: { service: serviceReadWhere(actor) },
    },
    take: MAX_IMPACT_ROWS,
    select: {
      businessServiceId: true,
      startedAt: true,
      endedAt: true,
      incident: { select: { serviceId: true, service: { select: { name: true } } } },
    },
  });
  const members = new Map(
    services.map(service => [service.id, new Set(service.members.map(m => m.serviceId))])
  );
  const intervals = new Map<
    string,
    { name: string; spans: Array<{ start: number; end: number }> }
  >();
  for (const row of rows) {
    if (!members.get(row.businessServiceId)?.has(row.incident.serviceId)) continue;
    const key = `${row.businessServiceId}\u0000${row.incident.serviceId}`;
    const entry = intervals.get(key) ?? { name: row.incident.service.name, spans: [] };
    entry.spans.push({ start: row.startedAt.getTime(), end: (row.endedAt ?? now).getTime() });
    intervals.set(key, entry);
  }
  const bounds = { from: window.from.getTime(), to: Math.min(window.to.getTime(), now.getTime()) };
  for (const [key, entry] of intervals) {
    const [businessServiceId, serviceId] = key.split('\u0000');
    const impactMinutes = unionDurationMs(entry.spans, bounds) / 60_000;
    const current = result.get(businessServiceId);
    if (impactMinutes > 0 && (!current || impactMinutes > current.impactMinutes))
      result.set(businessServiceId, { id: serviceId, name: entry.name, impactMinutes });
  }
  return result;
}

const csvCell = (value: string | number | null) => {
  if (value === null) return '';
  const text = String(value);
  // Neutralise spreadsheet formulas and quote everything that needs it.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const round = (value: number | null, digits = 1) =>
  value === null ? null : Number(value.toFixed(digits));

export function impactReportCsv(report: ImpactReport): string {
  const header = [
    'Business service',
    'Tier',
    'Owner team',
    'Uptime %',
    'Incidents',
    'MTTA (min)',
    'MTTR (min)',
    'Impacted hours',
    'Worst member',
    'Worst member impacted hours',
  ];
  const lines = report.rows.map(row =>
    [
      row.name,
      row.criticality,
      row.ownerTeam?.name ?? null,
      round(row.stats.uptimePercent, 3),
      row.stats.incidentCount,
      round(row.stats.mttaMinutes),
      round(row.stats.mttrMinutes),
      round(row.stats.impactMinutes / 60, 2),
      row.worstMember?.name ?? null,
      row.worstMember ? round(row.worstMember.impactMinutes / 60, 2) : null,
    ]
      .map(csvCell)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
