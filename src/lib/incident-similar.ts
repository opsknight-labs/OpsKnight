import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SIMILAR_DEFAULT_LIMIT = 5;
export const SIMILAR_MAX_LIMIT = 10;
/** Only resolved incidents this recent are compared; older ones rarely describe today's systems. */
export const SIMILAR_LOOKBACK_DAYS = 365;
/** At most this many candidates are scored per request. */
export const SIMILAR_CANDIDATE_LIMIT = 200;
const MIN_SCORE = 0.25;
/** One shared word in a long title is a coincidence; require this much of the title to overlap. */
const MIN_OVERLAP = 0.2;
const NOTE_EXCERPT_CHARS = 400;
const SEARCH_TOKENS = 5;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'has',
  'have',
  'not',
  'alert',
  'error',
  'issue',
  'high',
  'low',
  'critical',
  'warning',
]);

/** Lower-case word tokens of a title; short words, bare numbers and filler are dropped. */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3 && !/^\d+$/.test(token) && !STOP_WORDS.has(token))
  );
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export type SimilarReason = 'TITLE_OVERLAP' | 'SAME_SERVICE' | 'SAME_PRIORITY';

/**
 * Past resolved incidents that look like this one, with how each ended. Similarity is the overlap of
 * title words, nudged up by the same service and priority. This is a lead for a human, not proof of
 * the same cause: every row says why it matched.
 */
export async function findSimilarIncidents(input: {
  incident: { id: string; title: string; serviceId: string; priority: string | null };
  readWhere: Prisma.IncidentWhereInput;
  limit: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const source = titleTokens(input.incident.title);
  const searchTokens = [...source].sort((a, b) => b.length - a.length).slice(0, SEARCH_TOKENS);
  const candidates = await prisma.incident.findMany({
    where: {
      AND: [
        input.readWhere,
        { id: { not: input.incident.id }, status: 'RESOLVED' },
        { resolvedAt: { gte: new Date(now.getTime() - SIMILAR_LOOKBACK_DAYS * DAY_MS) } },
        {
          OR: [
            { serviceId: input.incident.serviceId },
            ...searchTokens.map(token => ({
              title: { contains: token, mode: 'insensitive' as const },
            })),
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      priority: true,
      serviceId: true,
      resolutionKind: true,
      createdAt: true,
      resolvedAt: true,
      service: { select: { name: true } },
    },
    orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
    take: SIMILAR_CANDIDATE_LIMIT,
  });

  const scored = candidates
    .map(candidate => {
      const overlap = jaccard(source, titleTokens(candidate.title));
      const sameService = candidate.serviceId === input.incident.serviceId;
      const samePriority =
        Boolean(candidate.priority) && candidate.priority === input.incident.priority;
      const score = overlap * 0.7 + (sameService ? 0.2 : 0) + (samePriority ? 0.1 : 0);
      const reasons: SimilarReason[] = [
        ...(overlap > 0 ? (['TITLE_OVERLAP'] as const) : []),
        ...(sameService ? (['SAME_SERVICE'] as const) : []),
        ...(samePriority ? (['SAME_PRIORITY'] as const) : []),
      ];
      return { candidate, score, overlap, reasons };
    })
    // A shared service alone, or a single shared word, is not similarity.
    .filter(row => row.overlap >= MIN_OVERLAP && row.score >= MIN_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.candidate.resolvedAt?.getTime() ?? 0) - (a.candidate.resolvedAt?.getTime() ?? 0) ||
        a.candidate.id.localeCompare(b.candidate.id)
    );
  const top = scored.slice(0, input.limit);

  const notes = top.length
    ? await prisma.incidentNote.findMany({
        where: { incidentId: { in: top.map(row => row.candidate.id) } },
        select: { incidentId: true, content: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: top.length * 20,
      })
    : [];
  const lastNote = new Map<string, { content: string; createdAt: Date }>();
  for (const note of notes) if (!lastNote.has(note.incidentId)) lastNote.set(note.incidentId, note);

  return {
    incidentId: input.incident.id,
    basis: 'TITLE_AND_SERVICE' as const,
    candidatesConsidered: candidates.length,
    similar: top.map(({ candidate, score, reasons }) => {
      const note = lastNote.get(candidate.id);
      const resolvedAt = candidate.resolvedAt;
      return {
        incident: {
          id: candidate.id,
          title: candidate.title,
          priority: candidate.priority,
          serviceId: candidate.serviceId,
          serviceName: candidate.service.name,
          createdAt: candidate.createdAt.toISOString(),
          resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
        },
        similarity: Math.round(score * 100) / 100,
        reasons,
        resolutionKind: candidate.resolutionKind,
        durationMinutes: resolvedAt
          ? Math.max(0, Math.round((resolvedAt.getTime() - candidate.createdAt.getTime()) / 60_000))
          : null,
        lastNote: note
          ? {
              excerpt:
                note.content.length > NOTE_EXCERPT_CHARS
                  ? `${note.content.slice(0, NOTE_EXCERPT_CHARS)}…`
                  : note.content,
              createdAt: note.createdAt.toISOString(),
            }
          : null,
      };
    }),
    truncated: candidates.length >= SIMILAR_CANDIDATE_LIMIT || scored.length > input.limit,
  };
}
