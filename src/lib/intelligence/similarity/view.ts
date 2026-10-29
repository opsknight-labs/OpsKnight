import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, postmortemReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveEffectivePolicy, resolveEffectivePolicyForRequest } from '../settings/service';
import { getMyFeedback } from '../feedback/service';
import { semanticContent, type SimilarityComponents } from './scoring';

export interface SimilarIncidentView {
  /** The finding this row represents; the target of the viewer's feedback. */
  findingId: string;
  /** The viewer's own live verdict on this suggestion, if any. */
  myVerdict: 'HELPFUL' | 'NOT_HELPFUL' | null;
  incidentId: string;
  title: string;
  status: string;
  serviceName: string;
  createdAt: Date;
  resolvedAt: Date | null;
  /** How long the precedent took to resolve, in minutes; null while it is open. */
  minutesToResolve: number | null;
  /** The precedent's postmortem, when one exists and the viewer may read it: how it was fixed. */
  postmortem: { href: string; resolution: string | null } | null;
  /** Ranking signal in percent. It is NOT a calibrated probability. */
  matchPercent: number;
  reasons: string[];
}

const MAX_VISIBLE = 5;

const shortText = (text: string | null, max = 200) => {
  const value = text?.replace(/\s+/g, ' ').trim() ?? '';
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** Human-readable reasons derived only from numeric components, never from stored text. */
export function describeReasons(components: SimilarityComponents): string[] {
  const reasons: string[] = [];
  const wording = Math.max(components.template, components.tokens);
  const meaning = semanticContent(components.semantic);
  if (meaning > wording && meaning >= 0.5) reasons.push('Similar meaning');
  else if (wording >= 0.6) reasons.push('Very similar wording');
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
    typeof c.resolved === 'number' &&
    (c.semantic === undefined || typeof c.semantic === 'number')
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

  // Deduplicated per request: an incident page renders several cards that all need the same policy.
  const policy =
    client === prisma
      ? await resolveEffectivePolicyForRequest(source.serviceId)
      : await resolveEffectivePolicy(source.serviceId, client);
  if (policy.effectiveMode !== 'SUGGEST' && policy.effectiveMode !== 'AUTO') return null;

  const findings = await client.intelligenceFinding.findMany({
    where: { incidentId, kind: 'SIMILAR_INCIDENT', status: 'ACTIVE', subjectRef: { not: null } },
    orderBy: { rank: 'asc' },
    take: MAX_VISIBLE * 3,
    select: { id: true, subjectRef: true, confidence: true, evidence: true },
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
  // How a precedent was fixed is the most useful thing about it; its postmortem is shown only when readable.
  let postmortems = new Map<string, string | null>();
  try {
    const rows = await client.postmortem.findMany({
      where: {
        AND: [
          { incidentId: { in: visible.map(incident => incident.id) } },
          postmortemReadWhere(actor),
        ],
      },
      select: { incidentId: true, resolution: true },
    });
    postmortems = new Map(rows.map(row => [row.incidentId, row.resolution]));
  } catch {
    // No postmortem access: precedents are still shown, without their postmortems.
  }
  const mine = await getMyFeedback(
    actor,
    'FINDING',
    findings.map(f => f.id),
    client
  );

  const views: SimilarIncidentView[] = [];
  for (const finding of findings) {
    const target = byId.get(finding.subjectRef as string);
    if (!target) continue; // not visible to this viewer: dropped silently, never counted or hinted
    const evidence = finding.evidence as { components?: unknown } | null;
    const verdict = mine.get(finding.id);
    views.push({
      findingId: finding.id,
      myVerdict: verdict === 'HELPFUL' || verdict === 'NOT_HELPFUL' ? verdict : null,
      incidentId: target.id,
      title: target.title,
      status: target.status,
      serviceName: target.service.name,
      createdAt: target.createdAt,
      resolvedAt: target.resolvedAt,
      minutesToResolve: target.resolvedAt
        ? Math.max(
            0,
            Math.round((target.resolvedAt.getTime() - target.createdAt.getTime()) / 60_000)
          )
        : null,
      postmortem: postmortems.has(target.id)
        ? {
            href: `/postmortems/${target.id}`,
            resolution: shortText(postmortems.get(target.id) ?? null),
          }
        : null,
      matchPercent: Math.round(finding.confidence * 100),
      reasons: isComponents(evidence?.components) ? describeReasons(evidence.components) : [],
    });
    if (views.length === MAX_VISIBLE) break;
  }
  return views.length > 0 ? views : null;
}
