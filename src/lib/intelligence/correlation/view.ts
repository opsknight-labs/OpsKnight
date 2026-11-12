import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveEffectivePolicy, resolveEffectivePolicyForRequest } from '../settings/service';

export interface RelatedIncidentView {
  relationshipId: string;
  decision: 'SUGGESTED' | 'ACCEPTED';
  origin: 'RULE' | 'LEARNED' | 'HUMAN';
  automatic: boolean;
  /** Rule that proposed the link, for the "why" explanation. Absent for manual links. */
  ruleId: string | null;
  incidentId: string;
  title: string;
  status: string;
  serviceName: string;
  createdAt: Date;
}

const MAX_VISIBLE = 10;

function ruleIdFrom(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== 'object') return null;
  const value = (evidence as { ruleId?: unknown }).ruleId;
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

/**
 * Related incidents for one incident as the actor may see them. Shown only when the effective policy
 * surfaces suggestions (SUGGEST/AUTO); SHADOW records but never displays. Manual links made by people
 * are always shown, since a person chose them. Both ends of every link must be readable by the actor.
 */
export async function getRelatedIncidentsForActor(
  incidentId: string,
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<RelatedIncidentView[] | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable: ReturnType<typeof incidentReadWhere>;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const source = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: { serviceId: true },
  });
  if (!source) return null;

  // Deduplicated per request: an incident page renders several cards that all need the same policy.
  const policy =
    client === prisma
      ? await resolveEffectivePolicyForRequest(source.serviceId)
      : await resolveEffectivePolicy(source.serviceId, client);
  const surfaced = policy.effectiveMode === 'SUGGEST' || policy.effectiveMode === 'AUTO';

  const links = await client.incidentRelationship.findMany({
    where: {
      type: 'RELATED',
      OR: [{ sourceIncidentId: incidentId }, { targetIncidentId: incidentId }],
      decision: { in: ['SUGGESTED', 'ACCEPTED'] },
      // Rule suggestions need a visible mode; human links always show.
      ...(surfaced
        ? {}
        : { AND: [{ OR: [{ origin: 'HUMAN' as const }, { decision: 'ACCEPTED' as const }] }] }),
    },
    orderBy: [{ decision: 'asc' }, { createdAt: 'desc' }],
    take: MAX_VISIBLE * 3,
    select: {
      id: true,
      decision: true,
      origin: true,
      evidence: true,
      sourceIncidentId: true,
      targetIncidentId: true,
    },
  });
  if (links.length === 0) return null;

  const pairs = links.map(link => ({
    link,
    otherId: link.sourceIncidentId === incidentId ? link.targetIncidentId : link.sourceIncidentId,
  }));
  const otherIds = pairs.map(pair => pair.otherId);
  const visible = await client.incident.findMany({
    where: { AND: [{ id: { in: otherIds } }, readable] },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      service: { select: { name: true } },
    },
  });
  const byId = new Map(visible.map(incident => [incident.id, incident]));

  const views: RelatedIncidentView[] = [];
  for (const { link, otherId } of pairs) {
    const other = byId.get(otherId);
    if (!other || views.length >= MAX_VISIBLE) continue; // hidden ends are dropped silently
    views.push({
      relationshipId: link.id,
      decision: link.decision === 'ACCEPTED' ? 'ACCEPTED' : 'SUGGESTED',
      origin: link.origin,
      automatic: Boolean(
        link.evidence &&
        typeof link.evidence === 'object' &&
        !Array.isArray(link.evidence) &&
        link.evidence.automatic === true
      ),
      ruleId: ruleIdFrom(link.evidence),
      incidentId: other.id,
      title: other.title,
      status: other.status,
      serviceName: other.service.name,
      createdAt: other.createdAt,
    });
  }
  return views.length > 0 ? views : null;
}
