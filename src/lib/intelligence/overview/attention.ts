import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { withDbBudget } from '../jobs/db-budget';
import { getWorkBacklog } from '../jobs/work-queue';
import { listServicePolicyOverview, resolveEffectivePolicy } from '../settings/service';
import type { AttentionItem, OverviewAttention } from './attention-contract';
import { OVERVIEW_SECTION_BUDGET } from './scope';

/** How far back the inbox looks for suggestions nobody has reviewed yet. */
export const ATTENTION_LOOKBACK_MS = 7 * 86_400_000;
/** Rows sampled per probe; an inbox is a prompt to act, not a report. */
export const ATTENTION_SAMPLE = 200;
/** Individual links shown per kind before the remainder is folded into one "more" row. */
export const ATTENTION_ITEMS_PER_KIND = 3;
/** Distinct services whose policy is resolved per probe. */
const ATTENTION_POLICY_SERVICES = 25;
/** Services inspected for a passed AUTO gate (the settings page's own bound). */
const ATTENTION_GATE_SERVICES = 100;

export {
  ATTENTION_KIND_LABELS,
  type AttentionItem,
  type AttentionKind,
  type OverviewAttention,
} from './attention-contract';

type Client = typeof prisma;
const OPEN_STATUSES = ['OPEN', 'ACKNOWLEDGED'] as const;
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const sampled = (count: number) =>
  count >= ATTENTION_SAMPLE ? `${ATTENTION_SAMPLE}+` : `${count}`;

async function probe(
  label: string,
  load: () => Promise<AttentionItem[]>
): Promise<AttentionItem[]> {
  try {
    return await load();
  } catch (error) {
    logger.warn(`[Intelligence] Overview inbox probe failed: ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Services whose effective policy shows suggestions to responders (and, optionally, has triage on). */
async function visibleServices(
  serviceIds: readonly string[],
  client: Client,
  requireTriage: boolean
): Promise<Set<string>> {
  const visible = new Set<string>();
  for (const serviceId of [...new Set(serviceIds)].slice(0, ATTENTION_POLICY_SERVICES)) {
    const policy = await resolveEffectivePolicy(serviceId, client);
    if (policy.effectiveMode !== 'SUGGEST' && policy.effectiveMode !== 'AUTO') continue;
    if (requireTriage && !policy.definition.triage.enabled) continue;
    visible.add(serviceId);
  }
  return visible;
}

interface PendingIncident {
  id: string;
  title: string;
  count: number;
  /** Newest suggestion on the incident (rows are read newest first). */
  at: Date;
}

function incidentItems(
  kind: 'triage' | 'related',
  pending: PendingIncident[],
  describe: (incident: PendingIncident) => string,
  more: (incidents: number) => string
): AttentionItem[] {
  const shown = pending.slice(0, ATTENTION_ITEMS_PER_KIND);
  const items: AttentionItem[] = shown.map(incident => ({
    id: `${kind}:${incident.id}`,
    kind,
    title: incident.title,
    detail: describe(incident),
    href: `/incidents/${encodeURIComponent(incident.id)}?insights=${kind}`,
    at: incident.at,
  }));
  const rest = pending.length - shown.length;
  if (rest > 0)
    items.push({
      id: `${kind}:more`,
      kind,
      title: more(rest),
      detail: 'Open the incident list to work through them.',
      href: '/incidents',
      at: pending[shown.length].at,
    });
  return items;
}

/** Triage chips on open incidents that nobody has accepted or dismissed. */
async function pendingTriage(
  actor: AuthorizationActor,
  client: Client,
  since: Date
): Promise<AttentionItem[]> {
  const readable = incidentReadWhere(actor);
  const findings = await withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    async tx => {
      const rows = await tx.intelligenceFinding.findMany({
        where: {
          createdAt: { gte: since },
          status: 'ACTIVE',
          kind: { in: ['TRIAGE_URGENCY', 'TRIAGE_ASSIGNMENT', 'TRIAGE_DUPLICATE'] },
          incident: { AND: [readable, { status: { in: [...OPEN_STATUSES] } }] },
        },
        orderBy: { createdAt: 'desc' },
        take: ATTENTION_SAMPLE,
        select: {
          id: true,
          incidentId: true,
          createdAt: true,
          incident: { select: { title: true, serviceId: true } },
        },
      });
      if (rows.length === 0) return [];
      const reviewed = await tx.intelligenceFeedback.findMany({
        where: { subjectType: 'FINDING', subjectId: { in: rows.map(row => row.id) } },
        take: ATTENTION_SAMPLE * 4,
        select: { subjectId: true },
      });
      const done = new Set(reviewed.map(row => row.subjectId));
      return rows.filter(row => !done.has(row.id));
    },
    client
  );
  if (findings.length === 0) return [];
  const visible = await visibleServices(
    findings.map(row => row.incident.serviceId),
    client,
    true
  );
  const byIncident = new Map<string, PendingIncident>();
  for (const row of findings) {
    if (!visible.has(row.incident.serviceId)) continue;
    const entry = byIncident.get(row.incidentId) ?? {
      id: row.incidentId,
      title: row.incident.title,
      count: 0,
      at: row.createdAt,
    };
    entry.count += 1;
    byIncident.set(row.incidentId, entry);
  }
  return incidentItems(
    'triage',
    [...byIncident.values()],
    incident => `${plural(incident.count, 'triage suggestion')} awaiting a decision`,
    rest => `${plural(rest, 'more incident')} with triage suggestions to review`
  );
}

/** Related and duplicate suggestions on open incidents that are still undecided. */
async function pendingRelated(
  actor: AuthorizationActor,
  client: Client,
  since: Date
): Promise<AttentionItem[]> {
  const readable = incidentReadWhere(actor);
  const rows = await withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    tx =>
      tx.incidentRelationship.findMany({
        where: {
          updatedAt: { gte: since },
          decision: 'SUGGESTED',
          type: { in: ['RELATED', 'DUPLICATE_OF'] },
          source: { AND: [readable, { status: { in: [...OPEN_STATUSES] } }] },
          target: readable,
        },
        orderBy: { updatedAt: 'desc' },
        take: ATTENTION_SAMPLE,
        select: {
          sourceIncidentId: true,
          updatedAt: true,
          source: { select: { title: true, serviceId: true } },
        },
      }),
    client
  );
  if (rows.length === 0) return [];
  const visible = await visibleServices(
    rows.map(row => row.source.serviceId),
    client,
    false
  );
  const byIncident = new Map<string, PendingIncident>();
  for (const row of rows) {
    if (!visible.has(row.source.serviceId)) continue;
    const entry = byIncident.get(row.sourceIncidentId) ?? {
      id: row.sourceIncidentId,
      title: row.source.title,
      count: 0,
      at: row.updatedAt,
    };
    entry.count += 1;
    byIncident.set(row.sourceIncidentId, entry);
  }
  return incidentItems(
    'related',
    [...byIncident.values()],
    incident => `${plural(incident.count, 'related-incident suggestion')} awaiting review`,
    rest => `${plural(rest, 'more incident')} with related-incident suggestions to review`
  );
}

/** Services in SHADOW or SUGGEST whose quality certification currently opens AUTO. */
async function passedGates(actor: AuthorizationActor, client: Client): Promise<AttentionItem[]> {
  const rows = await listServicePolicyOverview(
    { limit: ATTENTION_GATE_SERVICES, serviceWhere: serviceReadWhere(actor) },
    client
  );
  const ready = rows.filter(
    row => (row.effectiveMode === 'SHADOW' || row.effectiveMode === 'SUGGEST') && row.autoAvailable
  );
  const shown = ready.slice(0, ATTENTION_ITEMS_PER_KIND);
  const items: AttentionItem[] = shown.map(row => ({
    id: `gate:${row.serviceId}`,
    kind: 'gate',
    title: `${row.serviceName} can move to AUTO`,
    detail: `Running in ${row.effectiveMode.toLowerCase()}; its quality certification passed.`,
    href: `/settings/intelligence/services?q=${encodeURIComponent(row.serviceName)}`,
  }));
  if (ready.length > shown.length)
    items.push({
      id: 'gate:more',
      kind: 'gate',
      title: `${plural(ready.length - shown.length, 'more service')} ready for AUTO`,
      detail: 'Review them under per-service policies.',
      href: '/settings/intelligence/services#service-policies',
    });
  return items;
}

/** Dependencies the observer inferred from co-occurring incidents and nobody has approved or rejected. */
async function suggestedDependencies(client: Client): Promise<AttentionItem[]> {
  const rows = await withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    tx =>
      tx.serviceDependency.findMany({
        where: { status: 'SUGGESTED' },
        take: ATTENTION_SAMPLE,
        select: { id: true },
      }),
    client
  );
  if (rows.length === 0) return [];
  return [
    {
      id: 'dependencies',
      kind: 'dependencies',
      title: `${sampled(rows.length)} observed ${rows.length === 1 ? 'dependency' : 'dependencies'} to review`,
      detail: 'Inferred from incidents that keep occurring together. Approve or reject each one.',
      href: '/settings/intelligence/services#dependencies',
    },
  ];
}

/** Work items that failed repeatedly and wait for a replay. */
async function quarantinedWork(client: Client): Promise<AttentionItem[]> {
  const backlog = await withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    tx => getWorkBacklog(undefined, tx),
    client
  );
  if (backlog.quarantined <= 0) return [];
  return [
    {
      id: 'quarantine',
      kind: 'quarantine',
      title: `${plural(backlog.quarantined, 'quarantined work item')}`,
      detail: 'Analysis work that failed twice within a day and waits for a replay.',
      href: '/settings/intelligence#failed-work',
    },
  ];
}

/**
 * The overview's "Needs attention" inbox: things a person has to decide, each with the place to do it.
 * Every probe is bounded, scoped to what the actor may read, gated on the capability needed to act, and
 * fails soft to nothing, so the inbox is simply absent when it is empty or a probe is unavailable.
 * Suggestions are listed only for services whose policy shows them to responders (SUGGEST or AUTO).
 */
export async function getOverviewAttention(
  actor: AuthorizationActor,
  options: { client?: Client; now?: Date } = {}
): Promise<OverviewAttention> {
  const client = options.client ?? prisma;
  const since = new Date((options.now ?? new Date()).getTime() - ATTENTION_LOOKBACK_MS);
  const canSeeSuggestions = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ);
  const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  const groups = await Promise.all([
    canSeeSuggestions ? probe('triage', () => pendingTriage(actor, client, since)) : [],
    canSeeSuggestions ? probe('related', () => pendingRelated(actor, client, since)) : [],
    canManage ? probe('gate', () => passedGates(actor, client)) : [],
    canManage ? probe('dependencies', () => suggestedDependencies(client)) : [],
    canManage ? probe('quarantine', () => quarantinedWork(client)) : [],
  ]);
  return { items: groups.flat() };
}
