import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { RESPONSE_LIMITS } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import { upstreamDistances } from '../dependencies/graph';

/**
 * One time axis for an incident: its alerts, the changes on it and its upstream services around onset,
 * upstream incidents, and (when the noise layer exists) the noise decisions taken on its events. Every row is
 * filtered by what the viewer may read. Bounded: at most MAX_ROWS per kind, within the cause window
 * before onset and up to now.
 */

export type TimeAxisKind = 'ALERT' | 'CHANGE' | 'UPSTREAM_INCIDENT' | 'NOISE_DECISION' | 'INCIDENT';

export interface TimeAxisEntry {
  kind: TimeAxisKind;
  at: Date;
  title: string;
  detail: string | null;
  href: string | null;
  /** Minutes relative to incident onset (negative = before). */
  offsetMinutes: number;
  riskPercent?: number | null;
}

export interface IncidentTimeAxis {
  onset: Date;
  entries: TimeAxisEntry[];
  truncated: boolean;
}

const MAX_ROWS = 50;
const MINUTE_MS = 60_000;

export async function getIncidentTimeAxisForActor(
  incidentId: string,
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<IncidentTimeAxis | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable: ReturnType<typeof incidentReadWhere>;
  let services: ReturnType<typeof serviceReadWhere> | null;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  try {
    services = serviceReadWhere(actor);
  } catch {
    services = null;
  }
  const incident = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: { id: true, serviceId: true, title: true, createdAt: true, resolvedAt: true },
  });
  if (!incident) return null;
  const onset = incident.createdAt;
  const windowStart = new Date(onset.getTime() - RESPONSE_LIMITS.causeLookbackMinutes * MINUTE_MS);
  const until = incident.resolvedAt ?? new Date();
  const edges = await loadActiveEdges(client);
  const upstream = upstreamDistances(edges, incident.serviceId, RESPONSE_LIMITS.maxUpstreamDepth);
  const serviceIds = [incident.serviceId, ...upstream.keys()];

  const [alerts, changes, upstreamIncidents, noise] = await Promise.all([
    client.alert.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS + 1,
      select: { id: true, createdAt: true, severity: true, payload: true, status: true },
    }),
    services
      ? client.changeEvent.findMany({
          where: {
            occurredAt: { gte: windowStart, lte: until },
            OR: [{ serviceId: { in: serviceIds } }, { serviceId: null }],
            ...(Object.keys(services).length === 0
              ? {}
              : { OR: [{ serviceId: null }, { service: services }] }),
          },
          orderBy: { occurredAt: 'asc' },
          take: MAX_ROWS + 1,
          select: {
            id: true,
            kind: true,
            summary: true,
            source: true,
            url: true,
            occurredAt: true,
            riskScore: true,
            service: { select: { name: true } },
          },
        })
      : [],
    upstream.size === 0
      ? []
      : client.incident.findMany({
          where: {
            AND: [
              {
                id: { not: incidentId },
                serviceId: { in: [...upstream.keys()] },
                createdAt: { gte: windowStart, lte: until },
              },
              readable,
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: MAX_ROWS + 1,
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            service: { select: { name: true } },
          },
        }),
    loadNoiseDecisions(client, incidentId),
  ]);

  const entries: TimeAxisEntry[] = [];
  const offset = (at: Date) => Math.round((at.getTime() - onset.getTime()) / MINUTE_MS);
  entries.push({
    kind: 'INCIDENT',
    at: onset,
    title: `Incident opened: ${incident.title}`,
    detail: null,
    href: null,
    offsetMinutes: 0,
  });
  for (const alert of alerts.slice(0, MAX_ROWS)) {
    const payload = alert.payload as { summary?: unknown } | null;
    entries.push({
      kind: 'ALERT',
      at: alert.createdAt,
      title: typeof payload?.summary === 'string' ? payload.summary.slice(0, 200) : 'Alert',
      detail: [alert.severity, alert.status].filter(Boolean).join(' · ') || null,
      href: `/alerts/${alert.id}`,
      offsetMinutes: offset(alert.createdAt),
    });
  }
  for (const change of changes.slice(0, MAX_ROWS)) {
    entries.push({
      kind: 'CHANGE',
      at: change.occurredAt,
      title: change.summary,
      detail: `${change.kind.replace('_', ' ').toLowerCase()} · ${change.source}${change.service ? ` · ${change.service.name}` : ''}`,
      href: change.url ?? `/changes/${change.id}`,
      offsetMinutes: offset(change.occurredAt),
      riskPercent: change.riskScore === null ? null : Math.round(change.riskScore * 100),
    });
  }
  for (const other of upstreamIncidents.slice(0, MAX_ROWS)) {
    entries.push({
      kind: 'UPSTREAM_INCIDENT',
      at: other.createdAt,
      title: other.title,
      detail: `${other.service.name} · ${other.status.toLowerCase()}`,
      href: `/incidents/${other.id}`,
      offsetMinutes: offset(other.createdAt),
    });
  }
  for (const decision of noise) {
    entries.push({
      kind: 'NOISE_DECISION',
      at: decision.at,
      title: decision.title,
      detail: decision.detail,
      href: null,
      offsetMinutes: offset(decision.at),
    });
  }
  if (incident.resolvedAt)
    entries.push({
      kind: 'INCIDENT',
      at: incident.resolvedAt,
      title: 'Incident resolved',
      detail: null,
      href: null,
      offsetMinutes: offset(incident.resolvedAt),
    });
  entries.sort((a, b) => a.at.getTime() - b.at.getTime() || a.kind.localeCompare(b.kind));
  return {
    onset,
    entries,
    truncated:
      alerts.length > MAX_ROWS || changes.length > MAX_ROWS || upstreamIncidents.length > MAX_ROWS,
  };
}

/**
 * Noise decisions are owned by the pre-paging noise layer, which may not be deployed (or migrated) yet.
 * The table is read only when it exists; its shape is treated as loosely typed data.
 */
async function loadNoiseDecisions(
  client: typeof prisma,
  incidentId: string
): Promise<Array<{ at: Date; title: string; detail: string | null }>> {
  try {
    const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT * FROM "NoiseDecision" WHERE "incidentId" = ${incidentId}
      ORDER BY "createdAt" ASC LIMIT ${MAX_ROWS}`);
    return rows.flatMap(row => {
      const at = row.createdAt instanceof Date ? row.createdAt : null;
      if (!at) return [];
      const action = typeof row.action === 'string' ? row.action : 'decision';
      const mode = typeof row.mode === 'string' ? row.mode : null;
      const reason = typeof row.reason === 'string' ? row.reason : null;
      return [
        {
          at,
          title: `Noise control: ${action.toLowerCase().replace(/_/g, ' ')}`,
          detail:
            [mode ? `${mode.toLowerCase()} mode` : null, reason].filter(Boolean).join(' · ') ||
            null,
        },
      ];
    });
  } catch {
    return [];
  }
}
