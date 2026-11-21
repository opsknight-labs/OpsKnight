import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveEffectivePolicy, resolveEffectivePolicyForRequest } from '../settings/service';
import { getMyFeedback } from '../feedback/service';
import { TRIAGE_FINDING_KINDS } from './predict';

export interface TriageSuggestionView {
  findingId: string;
  kind: (typeof TRIAGE_FINDING_KINDS)[number];
  confidencePercent: number;
  /** Suggested urgency (TRIAGE_URGENCY). */
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Suggested owner (TRIAGE_ASSIGNMENT). */
  owner?: { type: 'team' | 'user'; id: string; name: string };
  /** Probable duplicate (TRIAGE_DUPLICATE). */
  duplicate?: { incidentId: string; title: string; status: string; gapMinutes: number };
  /** Expected time to resolve (TRIAGE_RESOLUTION_TIME). */
  resolution?: {
    expectedMinutes: number;
    lowMinutes: number;
    highMinutes: number;
    samples: number;
  };
  /** The viewer's own verdict, if they already accepted or dismissed it. */
  myVerdict: 'HELPFUL' | 'NOT_HELPFUL' | null;
  precedents: number;
  sloBurning: boolean;
}

export interface TriageView {
  suggestions: TriageSuggestionView[];
  canAct: boolean;
}

type Evidence = Record<string, unknown>;
const asEvidence = (value: unknown): Evidence =>
  value && typeof value === 'object' ? (value as Evidence) : {};
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Triage suggestions for one incident, as the actor may see them. Null when nothing should be shown:
 * no capability, incident not visible, policy not in a visible mode, triage off, or no suggestions.
 * Referenced teams, people and incidents pass through the viewer's own read rules.
 */
export async function getTriageForActor(
  incidentId: string,
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<TriageView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable: ReturnType<typeof incidentReadWhere>;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const incident = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: { serviceId: true, status: true },
  });
  if (!incident) return null;
  const policy =
    client === prisma
      ? await resolveEffectivePolicyForRequest(incident.serviceId)
      : await resolveEffectivePolicy(incident.serviceId, client);
  if (policy.effectiveMode !== 'SUGGEST' && policy.effectiveMode !== 'AUTO') return null;
  if (!policy.definition.triage.enabled) return null;

  const findings = await client.intelligenceFinding.findMany({
    where: { incidentId, status: 'ACTIVE', kind: { in: [...TRIAGE_FINDING_KINDS] } },
    orderBy: [{ kind: 'asc' }, { rank: 'asc' }],
    take: 8,
    select: { id: true, kind: true, confidence: true, subjectRef: true, evidence: true },
  });
  if (findings.length === 0) return null;

  const teamIds = findings
    .filter(f => f.kind === 'TRIAGE_ASSIGNMENT' && f.subjectRef?.startsWith('team:'))
    .map(f => (f.subjectRef as string).slice(5));
  const userIds = findings
    .filter(f => f.kind === 'TRIAGE_ASSIGNMENT' && f.subjectRef?.startsWith('user:'))
    .map(f => (f.subjectRef as string).slice(5));
  const duplicateIds = findings
    .filter(f => f.kind === 'TRIAGE_DUPLICATE' && f.subjectRef)
    .map(f => f.subjectRef as string);
  const [teams, users, duplicates, mine] = await Promise.all([
    teamIds.length
      ? client.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
      : [],
    userIds.length
      ? client.user.findMany({
          where: { id: { in: userIds }, status: 'ACTIVE' },
          select: { id: true, name: true, email: true },
        })
      : [],
    duplicateIds.length
      ? client.incident.findMany({
          where: { AND: [{ id: { in: duplicateIds } }, readable] },
          select: { id: true, title: true, status: true },
        })
      : [],
    getMyFeedback(
      actor,
      'FINDING',
      findings.map(f => f.id),
      client
    ),
  ]);
  const teamById = new Map(teams.map(t => [t.id, t.name]));
  const userById = new Map(users.map(u => [u.id, u.name || u.email]));
  const duplicateById = new Map(duplicates.map(d => [d.id, d]));

  const suggestions: TriageSuggestionView[] = [];
  for (const finding of findings) {
    const evidence = asEvidence(finding.evidence);
    const verdict = mine.get(finding.id);
    const base = {
      findingId: finding.id,
      kind: finding.kind as TriageSuggestionView['kind'],
      confidencePercent: Math.round(finding.confidence * 100),
      myVerdict: verdict === 'HELPFUL' || verdict === 'NOT_HELPFUL' ? verdict : null,
      precedents: Math.round(num(evidence.voters) || num(evidence.samples)),
      sloBurning: evidence.sloBurning === true,
    };
    if (finding.kind === 'TRIAGE_URGENCY') {
      const urgency = finding.subjectRef;
      if (urgency === 'LOW' || urgency === 'MEDIUM' || urgency === 'HIGH')
        suggestions.push({ ...base, urgency });
    } else if (finding.kind === 'TRIAGE_ASSIGNMENT' && finding.subjectRef) {
      const [type, id] = finding.subjectRef.split(':', 2);
      const name = type === 'team' ? teamById.get(id) : type === 'user' ? userById.get(id) : null;
      if ((type === 'team' || type === 'user') && name)
        suggestions.push({ ...base, owner: { type, id, name } });
    } else if (finding.kind === 'TRIAGE_DUPLICATE' && finding.subjectRef) {
      const other = duplicateById.get(finding.subjectRef);
      if (other)
        suggestions.push({
          ...base,
          duplicate: {
            incidentId: other.id,
            title: other.title,
            status: other.status,
            gapMinutes: Math.round(num(evidence.gapMinutes)),
          },
        });
    } else if (finding.kind === 'TRIAGE_RESOLUTION_TIME') {
      suggestions.push({
        ...base,
        resolution: {
          expectedMinutes: Math.round(num(evidence.expectedMinutes)),
          lowMinutes: Math.round(num(evidence.lowMinutes)),
          highMinutes: Math.round(num(evidence.highMinutes)),
          samples: Math.round(num(evidence.samples)),
        },
      });
    }
  }
  if (suggestions.length === 0) return null;
  return {
    suggestions,
    canAct:
      incident.status !== 'RESOLVED' &&
      hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK),
  };
}
