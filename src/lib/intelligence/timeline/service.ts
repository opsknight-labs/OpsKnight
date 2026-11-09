import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { RESPONSE_LIMITS } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import { upstreamDistances } from '../dependencies/graph';
import { explainNoiseDecision, incidentRef } from '../incident-ux/explain';

/**
 * One time axis for an incident: its alerts, the changes on it and its upstream services around onset,
 * upstream incidents, the noise decisions taken on its events (with why and, for managers, the reversal),
 * grouping into a parent, and people's decisions on intelligence suggestions (related links accepted or
 * rejected, triage suggestions accepted or dismissed). Every row is filtered by what the viewer may read.
 * Bounded: at most MAX_ROWS per kind, within the cause window before onset and up to now.
 */

export type TimeAxisKind =
  | 'ALERT'
  | 'CHANGE'
  | 'UPSTREAM_INCIDENT'
  | 'NOISE_DECISION'
  | 'INCIDENT'
  | 'GROUPING'
  | 'SUGGESTION'
  | 'TRIAGE';

export interface TimeAxisEntry {
  kind: TimeAxisKind;
  at: Date;
  title: string;
  detail: string | null;
  href: string | null;
  /** Minutes relative to incident onset (negative = before). */
  offsetMinutes: number;
  riskPercent?: number | null;
  /** NOISE_DECISION: the reasons behind the decision, one per line. */
  why?: string[];
  /** NOISE_DECISION: present when the viewer may still reverse the decision. */
  reversal?: { decisionId: string; pages: boolean } | null;
  reversed?: boolean;
}

export interface IncidentTimeAxis {
  onset: Date;
  entries: TimeAxisEntry[];
  truncated: boolean;
  /** Whether the viewer may reverse noise decisions (INTELLIGENCE_MANAGE), as on the noise settings page. */
  canReverse: boolean;
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

  const [alerts, changes, upstreamIncidents, noise, decisions] = await Promise.all([
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
    loadSuggestionDecisions(client, incidentId, readable),
  ]);
  const canReverse =
    actor.status === 'ACTIVE' && hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);

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
  for (const decision of noise.slice(0, MAX_ROWS)) {
    entries.push({
      kind: 'NOISE_DECISION',
      at: decision.at,
      title: decision.title,
      detail: decision.detail,
      href: decision.alertId ? `/alerts/${decision.alertId}` : null,
      offsetMinutes: offset(decision.at),
      why: decision.why,
      reversed: decision.reversed,
      reversal:
        canReverse && !decision.reversed
          ? { decisionId: decision.id, pages: decision.reversalPages }
          : null,
    });
  }
  for (const decision of decisions) {
    entries.push({ ...decision, offsetMinutes: offset(decision.at) });
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
      alerts.length > MAX_ROWS ||
      changes.length > MAX_ROWS ||
      upstreamIncidents.length > MAX_ROWS ||
      noise.length > MAX_ROWS,
    canReverse,
  };
}

type NoiseEntry = {
  id: string;
  at: Date;
  alertId: string | null;
  title: string;
  detail: string | null;
  why: string[];
  reversed: boolean;
  reversalPages: boolean;
};

/**
 * Pre-paging decisions recorded on this incident's events (suppressed, in maintenance, grouped,
 * deduplicated, held), oldest first. Index-backed (PrePagingDecision.incidentId). On a schema where the
 * noise layer is not migrated yet the read fails and there is simply nothing to show.
 */
async function loadNoiseDecisions(
  client: typeof prisma,
  incidentId: string
): Promise<NoiseEntry[]> {
  try {
    const rows = await client.prePagingDecision.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        alertId: true,
        control: true,
        action: true,
        mode: true,
        applied: true,
        sourceName: true,
        reason: true,
        evidence: true,
        reversedAt: true,
        createdAt: true,
      },
    });
    return rows.map(row => {
      const explained = explainNoiseDecision(row);
      return {
        id: row.id,
        at: row.createdAt,
        alertId: row.alertId,
        title: explained.title,
        detail: [`${row.mode.toLowerCase()} mode`, row.reversedAt ? 'reversed' : null]
          .filter(Boolean)
          .join(' · '),
        why: explained.why,
        reversed: row.reversedAt !== null,
        reversalPages: explained.reversalPages,
      };
    });
  } catch {
    return [];
  }
}

const DECISION_VERB: Record<string, string> = {
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  REVERTED: 'undone',
};

const TRIAGE_LABEL = {
  TRIAGE_URGENCY: 'urgency',
  TRIAGE_ASSIGNMENT: 'owner',
  TRIAGE_DUPLICATE: 'duplicate',
  TRIAGE_RESOLUTION_TIME: 'time to resolve',
} as const;
const TRIAGE_KINDS = Object.keys(TRIAGE_LABEL) as Array<keyof typeof TRIAGE_LABEL>;

/**
 * People's (and the engine's) decisions on intelligence for this incident: grouping under a parent, related
 * links accepted, rejected or undone, and triage suggestions accepted or dismissed. The other incident is
 * named and linked only when the viewer may read it. Bounded per source; index-backed throughout.
 */
async function loadSuggestionDecisions(
  client: typeof prisma,
  incidentId: string,
  readable: ReturnType<typeof incidentReadWhere>
): Promise<Array<Omit<TimeAxisEntry, 'offsetMinutes'>>> {
  const [links, triage] = await Promise.all([
    client.incidentRelationshipEvent.findMany({
      where: {
        toDecision: { in: ['ACCEPTED', 'REJECTED', 'REVERTED'] },
        relationship: {
          OR: [{ sourceIncidentId: incidentId }, { targetIncidentId: incidentId }],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS,
      select: {
        toDecision: true,
        actorType: true,
        actorId: true,
        createdAt: true,
        relationship: {
          select: { type: true, sourceIncidentId: true, targetIncidentId: true },
        },
      },
    }),
    client.intelligenceFinding.findMany({
      where: { incidentId, kind: { in: TRIAGE_KINDS } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: { id: true, kind: true, subjectRef: true },
    }),
  ]);
  const otherOf = (rel: { sourceIncidentId: string; targetIncidentId: string }) =>
    rel.sourceIncidentId === incidentId ? rel.targetIncidentId : rel.sourceIncidentId;
  const otherIds = [...new Set(links.map(event => otherOf(event.relationship)))];
  const actorIds = [...new Set(links.flatMap(event => (event.actorId ? [event.actorId] : [])))];
  const [feedback, visible, actors] = await Promise.all([
    triage.length
      ? client.intelligenceFeedback.findMany({
          where: { subjectType: 'FINDING', subjectId: { in: triage.map(f => f.id) } },
          orderBy: { createdAt: 'asc' },
          take: MAX_ROWS,
          select: {
            subjectId: true,
            verdict: true,
            createdAt: true,
            actor: { select: { name: true } },
          },
        })
      : [],
    otherIds.length
      ? client.incident.findMany({
          where: { AND: [{ id: { in: otherIds } }, readable] },
          select: { id: true, title: true },
        })
      : [],
    actorIds.length
      ? client.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const titleOf = new Map(visible.map(row => [row.id, row.title]));
  const nameOf = new Map(actors.map(row => [row.id, row.name]));

  const entries: Array<Omit<TimeAxisEntry, 'offsetMinutes'>> = [];
  for (const event of links) {
    const { type, sourceIncidentId } = event.relationship;
    const otherId = otherOf(event.relationship);
    const otherTitle = titleOf.get(otherId);
    const other = otherTitle
      ? `${incidentRef(otherId)} ${otherTitle}`
      : 'an incident you cannot view';
    const who =
      event.actorType === 'SYSTEM'
        ? 'automatically'
        : `by ${(event.actorId && nameOf.get(event.actorId)) || 'a responder'}`;
    const verb = DECISION_VERB[event.toDecision] ?? event.toDecision.toLowerCase();
    const parentChild = type === 'PARENT_CHILD';
    const title = !parentChild
      ? `Related link to ${other} ${verb}`
      : event.toDecision !== 'ACCEPTED'
        ? `Grouping with ${other} ${verb}`
        : sourceIncidentId === incidentId
          ? `Grouped into parent ${other}`
          : `${other} grouped under this incident`;
    entries.push({
      kind: parentChild ? 'GROUPING' : 'SUGGESTION',
      at: event.createdAt,
      title: title.slice(0, 240),
      detail: `${parentChild ? 'Grouping' : 'Suggestion'} ${verb} ${who}`,
      href: otherTitle ? `/incidents/${otherId}` : null,
    });
  }
  const findingById = new Map(triage.map(f => [f.id, f]));
  for (const row of feedback) {
    const finding = findingById.get(row.subjectId);
    if (!finding) continue;
    const accepted = row.verdict === 'HELPFUL' || row.verdict === 'CORRECT';
    const label = TRIAGE_LABEL[finding.kind as keyof typeof TRIAGE_LABEL] ?? 'triage';
    const value =
      finding.kind === 'TRIAGE_URGENCY' && finding.subjectRef
        ? ` (${finding.subjectRef.toLowerCase()})`
        : '';
    entries.push({
      kind: 'TRIAGE',
      at: row.createdAt,
      title: `Triage suggestion for ${label}${value} ${accepted ? 'accepted' : 'dismissed'}`,
      detail: `by ${row.actor?.name ?? 'a responder'}`,
      href: null,
    });
  }
  return entries;
}
