import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
export const SIMILAR_DEFAULT_LIMIT = 5;
export const SIMILAR_MAX_LIMIT = 10;
/** Only resolved incidents this recent are compared; older ones rarely describe today's systems. */
export const SIMILAR_LOOKBACK_DAYS = 365;
/** The same-service candidate pool holds at most this many incidents. */
export const SIMILAR_POOL_LIMIT = 150;
/**
 * Each title word is searched on its own with this quota, so one very common word (a product or
 * service name) cannot fill the pool and crowd out the rarer words that actually discriminate.
 */
export const SIMILAR_WORD_LIMIT = 40;
const MIN_SCORE = 0.25;
/** One shared word in a long title is a coincidence; require this much of the text to overlap. */
const MIN_OVERLAP = 0.2;
const NOTE_EXCERPT_CHARS = 400;
const DESCRIPTION_CHARS = 600;
const SEARCH_WORDS = 5;
const NOTES_PER_INCIDENT = 30;
/** A note written up to this long after the incident closed still counts as its resolution note. */
const RESOLUTION_NOTE_GRACE_MS = 5 * MINUTE_MS;

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

/**
 * Words that mean the same thing to an on-call engineer. Small and reviewed on purpose: each group
 * collapses to its first word, and anything not listed is compared as written.
 */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['database', 'db', 'postgres', 'postgresql', 'mysql', 'sql', 'rds'],
  ['latency', 'slow', 'slowness', 'lag', 'laggy', 'sluggish'],
  ['timeout', 'timeouts', 'timedout', 'deadline'],
  ['outage', 'down', 'unavailable', 'unreachable', 'offline'],
  ['memory', 'oom', 'ram'],
  ['crash', 'crashed', 'crashing', 'crashloop', 'panic'],
  ['disk', 'storage', 'volume', 'quota'],
  ['certificate', 'cert', 'tls', 'ssl'],
  ['deploy', 'deployment', 'release', 'rollout', 'rollback'],
  ['queue', 'backlog', 'lagging'],
  ['auth', 'authentication', 'login', 'signin'],
];
const SYNONYM = new Map(
  SYNONYM_GROUPS.flatMap(group => group.map(word => [word, group[0]!] as const))
);

/** Lower-case, strip a plural or verb ending, then fold synonyms; the same on both sides of a comparison. */
function normalise(word: string): string {
  const direct = SYNONYM.get(word);
  if (direct) return direct;
  let stem = word;
  if (stem.length > 5 && stem.endsWith('ing')) stem = stem.slice(0, -3);
  else if (stem.length > 4 && stem.endsWith('ed')) stem = stem.slice(0, -2);
  else if (stem.length > 4 && stem.endsWith('es')) stem = stem.slice(0, -2);
  else if (stem.length > 3 && stem.endsWith('s') && !stem.endsWith('ss')) stem = stem.slice(0, -1);
  return SYNONYM.get(stem) ?? stem;
}

function rawWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !/^\d+$/.test(word) && !STOP_WORDS.has(word));
}

/** Normalised word set of some text; short words, bare numbers and filler are dropped. */
export function titleTokens(text: string): Set<string> {
  return new Set(rawWords(text).map(normalise));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export type SimilarReason = 'TITLE_OVERLAP' | 'SAME_SERVICE' | 'SAME_PRIORITY';

const bodyOf = (title: string, description: string | null) =>
  `${title} ${(description ?? '').slice(0, DESCRIPTION_CHARS)}`;

/**
 * Past resolved incidents that look like this one, with how each ended. Similarity is the overlap of
 * title words (70%) and title-plus-description words (30%), after light stemming and a small
 * synonym table, nudged up by the same service and priority. It is a lead for a human, not proof of
 * the same cause: every row says why it matched, and a shared service or one shared word is never
 * enough on its own.
 */
export async function findSimilarIncidents(input: {
  incident: {
    id: string;
    title: string;
    description?: string | null;
    serviceId: string;
    priority: string | null;
  };
  readWhere: Prisma.IncidentWhereInput;
  limit: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const sourceTitle = titleTokens(input.incident.title);
  const sourceBody = titleTokens(bodyOf(input.incident.title, input.incident.description ?? null));
  // The database matches the words as written; the scoring below folds them.
  const searchWords = [...new Set(rawWords(input.incident.title))]
    .sort((a, b) => b.length - a.length)
    .slice(0, SEARCH_WORDS);
  const base: Prisma.IncidentWhereInput = {
    AND: [
      input.readWhere,
      { id: { not: input.incident.id }, status: 'RESOLVED' },
      { resolvedAt: { gte: new Date(now.getTime() - SIMILAR_LOOKBACK_DAYS * DAY_MS) } },
    ],
  };
  const select = {
    id: true,
    title: true,
    description: true,
    priority: true,
    serviceId: true,
    resolutionKind: true,
    createdAt: true,
    resolvedAt: true,
    service: { select: { name: true } },
  } satisfies Prisma.IncidentSelect;
  const order = [
    { resolvedAt: 'desc' },
    { id: 'desc' },
  ] satisfies Prisma.IncidentOrderByWithRelationInput[];
  // Candidates come from the same service and, separately for each title word, from anywhere: a
  // busy service or a common word cannot crowd older, better matches out of the comparison.
  const [sameService, ...byWord] = await Promise.all([
    prisma.incident.findMany({
      where: { AND: [base, { serviceId: input.incident.serviceId }] },
      select,
      orderBy: order,
      take: SIMILAR_POOL_LIMIT,
    }),
    ...searchWords.map(word =>
      prisma.incident.findMany({
        where: { AND: [base, { title: { contains: word, mode: 'insensitive' as const } }] },
        select,
        orderBy: order,
        take: SIMILAR_WORD_LIMIT,
      })
    ),
  ]);
  const pool = new Map([...sameService, ...byWord.flat()].map(row => [row.id, row] as const));
  const candidates = [...pool.values()];

  const scored = candidates
    .map(candidate => {
      const titleOverlap = jaccard(sourceTitle, titleTokens(candidate.title));
      const bodyOverlap = jaccard(
        sourceBody,
        titleTokens(bodyOf(candidate.title, candidate.description))
      );
      const overlap = titleOverlap * 0.7 + bodyOverlap * 0.3;
      const sameServiceMatch = candidate.serviceId === input.incident.serviceId;
      const samePriority =
        Boolean(candidate.priority) && candidate.priority === input.incident.priority;
      const score = overlap * 0.7 + (sameServiceMatch ? 0.2 : 0) + (samePriority ? 0.1 : 0);
      const reasons: SimilarReason[] = [
        ...(overlap > 0 ? (['TITLE_OVERLAP'] as const) : []),
        ...(sameServiceMatch ? (['SAME_SERVICE'] as const) : []),
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
        take: top.length * NOTES_PER_INCIDENT,
      })
    : [];
  const notesByIncident = new Map<string, { content: string; createdAt: Date }[]>();
  for (const note of notes) {
    const list = notesByIncident.get(note.incidentId) ?? [];
    list.push(note);
    notesByIncident.set(note.incidentId, list);
  }
  /** The last note written at or before resolution, else the newest note (flagged as later). */
  const resolutionNote = (incidentId: string, resolvedAt: Date | null) => {
    const list = notesByIncident.get(incidentId) ?? [];
    if (resolvedAt) {
      const cutoff = resolvedAt.getTime() + RESOLUTION_NOTE_GRACE_MS;
      const atResolution = list.find(note => note.createdAt.getTime() <= cutoff);
      if (atResolution) return { note: atResolution, writtenBeforeResolution: true };
    }
    const newest = list[0];
    return newest ? { note: newest, writtenBeforeResolution: false } : null;
  };

  return {
    incidentId: input.incident.id,
    basis: 'TITLE_AND_SERVICE' as const,
    candidatesConsidered: candidates.length,
    similar: top.map(({ candidate, score, reasons }) => {
      const found = resolutionNote(candidate.id, candidate.resolvedAt);
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
        lastNote: found
          ? {
              excerpt:
                found.note.content.length > NOTE_EXCERPT_CHARS
                  ? `${found.note.content.slice(0, NOTE_EXCERPT_CHARS)}…`
                  : found.note.content,
              createdAt: found.note.createdAt.toISOString(),
              writtenBeforeResolution: found.writtenBeforeResolution,
            }
          : null,
      };
    }),
    truncated:
      sameService.length >= SIMILAR_POOL_LIMIT ||
      byWord.some(rows => rows.length >= SIMILAR_WORD_LIMIT) ||
      scored.length > input.limit,
  };
}
