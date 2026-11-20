import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveEffectivePolicy, resolveEffectivePolicyForRequest } from '../settings/service';
import { peopleSuggestionsEnabled } from '../people/enabled';

export interface IncidentExpert {
  userId: string;
  name: string;
  /** Similar incidents (last 180 days) this person resolved as the assignee. */
  resolved: number;
  /** Similar incidents (last 180 days) this person wrote notes on without resolving them. */
  noted: number;
}

export const EXPERT_WINDOW_DAYS = 180;
const MAX_PRECEDENTS = 15;
const MAX_EXPERTS = 3;
/** A note is half the signal of having resolved the incident. */
const NOTE_WEIGHT = 0.5;

/**
 * Suggested responders for an incident: people who resolved, or wrote notes on, the similar resolved
 * incidents the similarity engine already found (its ACTIVE findings) in the last 180 days. Only
 * precedents the viewer may read count, and only active people who can work the service are named
 * (members of its owning team, or responders and admins). Empty while "Suggest people" is off, the
 * service's intelligence mode is not visible, or there is nothing to suggest. Read on demand, never from
 * ingestion. Four bounded reads.
 */
export async function loadIncidentExperts(
  actor: AuthorizationActor,
  incidentId: string,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<IncidentExpert[]> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return [];
  if (!(await peopleSuggestionsEnabled(client))) return [];
  let readable: ReturnType<typeof incidentReadWhere>;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return [];
  }
  const incident = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: {
      serviceId: true,
      assigneeId: true,
      service: { select: { teamId: true } },
      watchers: { select: { userId: true } },
    },
  });
  if (!incident) return [];
  const policy =
    client === prisma
      ? await resolveEffectivePolicyForRequest(incident.serviceId)
      : await resolveEffectivePolicy(incident.serviceId, client);
  if (policy.effectiveMode !== 'SUGGEST' && policy.effectiveMode !== 'AUTO') return [];
  if (!policy.definition.similarity.enabled) return [];

  // idx_intelligence_finding_lookup
  const findings = await client.intelligenceFinding.findMany({
    where: { incidentId, kind: 'SIMILAR_INCIDENT', status: 'ACTIVE', subjectRef: { not: null } },
    orderBy: { rank: 'asc' },
    take: MAX_PRECEDENTS,
    select: { subjectRef: true, confidence: true },
  });
  if (findings.length === 0) return [];
  const since = new Date(now.getTime() - EXPERT_WINDOW_DAYS * 86_400_000);
  const precedents = await client.incident.findMany({
    where: {
      AND: [
        { id: { in: findings.map(finding => finding.subjectRef as string) } },
        { status: 'RESOLVED', resolvedAt: { gte: since } },
        readable,
      ],
    },
    select: { id: true, assigneeId: true, notes: { select: { userId: true }, take: 50 } },
  });
  const weightOf = new Map(
    findings.map(finding => [finding.subjectRef as string, Math.max(0, finding.confidence)])
  );

  const scores = new Map<string, { score: number; resolved: number; noted: number }>();
  const credit = (userId: string, weight: number, field: 'resolved' | 'noted') => {
    const row = scores.get(userId) ?? { score: 0, resolved: 0, noted: 0 };
    row.score += field === 'resolved' ? weight : weight * NOTE_WEIGHT;
    // eslint-disable-next-line security/detect-object-injection -- field is the closed union resolved | noted
    row[field] += 1;
    scores.set(userId, row);
  };
  for (const precedent of precedents) {
    const weight = weightOf.get(precedent.id) ?? 0;
    if (precedent.assigneeId) credit(precedent.assigneeId, weight, 'resolved');
    const noters = new Set(precedent.notes.flatMap(note => (note.userId ? [note.userId] : [])));
    noters.delete(precedent.assigneeId ?? '');
    for (const userId of noters) credit(userId, weight, 'noted');
  }
  // Already on the incident: nothing to suggest.
  scores.delete(incident.assigneeId ?? '');
  for (const watcher of incident.watchers) scores.delete(watcher.userId);
  if (scores.size === 0) return [];

  const teamId = incident.service.teamId;
  const people = await client.user.findMany({
    where: {
      id: { in: [...scores.keys()] },
      status: 'ACTIVE',
      OR: [
        { role: { in: ['ADMIN', 'RESPONDER'] } },
        ...(teamId ? [{ teamMemberships: { some: { teamId } } }] : []),
      ],
    },
    select: { id: true, name: true },
  });
  return people
    .map(person => {
      const row = scores.get(person.id)!;
      return {
        userId: person.id,
        name: person.name,
        resolved: row.resolved,
        noted: row.noted,
        score: row.score,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, MAX_EXPERTS)
    .map(({ score: _score, ...expert }) => expert);
}
