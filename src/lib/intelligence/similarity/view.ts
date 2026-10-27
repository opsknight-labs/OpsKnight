import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveEffectivePolicy } from '../settings/service';
import type { SimilarityComponents } from './scoring';

export interface SimilarIncidentView {
  incidentId: string;
  title: string;
  status: string;
  serviceName: string;
  createdAt: Date;
  resolvedAt: Date | null;
  /** Ranking signal in percent. It is NOT a calibrated probability. */
  matchPercent: number;
  reasons: string[];
}

const MAX_VISIBLE = 5;

/** Human-readable reasons derived only from numeric components, never from stored text. */
export function describeReasons(components: SimilarityComponents): string[] {
  const reasons: string[] = [];
  if (Math.max(components.template, components.tokens) >= 0.6) reasons.push('Very similar wording');
  else reasons.push('Similar wording');
  if (components.labels >= 0.5) reasons.push('Shared labels');
  if (components.sameService === 1) reasons.push('Same service');
  if (components.resolved === 1) reasons.push('Previously resolved');
  return reasons;
}

function isComponents(value: unknown): value is SimilarityComponents {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<Record<keyof SimilarityComponents, unknown>>;
  return (
    typeof c.tokens === 'number' &&
    typeof c.template === 'number' &&
    typeof c.labels === 'number' &&
    typeof c.sameService === 'number' &&
    typeof c.recency === 'number' &&
    typeof c.resolved === 'number'
  );
}

/**
 * Similar past incidents for one incident, as the given actor may see them.
 *
 * Returns null whenever nothing should be shown: no read capability, the viewer cannot see the
 * incident, the policy is not in a visible mode (SHADOW only records), or there are no findings.
 * Every suggested precedent is filtered through the same incident visibility rule as the rest of the
 * application, so a finding can never reveal an incident the viewer is not entitled to read.
 */
export async function getSimilarIncidentsForActor(
  incidentId: string,
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<SimilarIncidentView[] | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;

  // An actor who is denied incident access (for example a disabled user) simply sees nothing.
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

  const policy = await resolveEffectivePolicy(source.serviceId, client);
  if (policy.effectiveMode !== 'SUGGEST' && policy.effectiveMode !== 'AUTO') return null;

  const findings = await client.intelligenceFinding.findMany({
    where: { incidentId, kind: 'SIMILAR_INCIDENT', status: 'ACTIVE', subjectRef: { not: null } },
    orderBy: { rank: 'asc' },
    take: MAX_VISIBLE * 3,
    select: { subjectRef: true, confidence: true, evidence: true },
  });
  if (findings.length === 0) return null;

  const visible = await client.incident.findMany({
    where: {
      AND: [{ id: { in: findings.map(f => f.subjectRef as string) } }, readable],
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      service: { select: { name: true } },
    },
  });
  const byId = new Map(visible.map(incident => [incident.id, incident]));

  const views: SimilarIncidentView[] = [];
  for (const finding of findings) {
    const target = byId.get(finding.subjectRef as string);
    if (!target) continue; // not visible to this viewer: dropped silently, never counted or hinted
    const evidence = finding.evidence as { components?: unknown } | null;
    views.push({
      incidentId: target.id,
      title: target.title,
      status: target.status,
      serviceName: target.service.name,
      createdAt: target.createdAt,
      resolvedAt: target.resolvedAt,
      matchPercent: Math.round(finding.confidence * 100),
      reasons: isComponents(evidence?.components) ? describeReasons(evidence.components) : [],
    });
    if (views.length === MAX_VISIBLE) break;
  }
  return views.length > 0 ? views : null;
}
