import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { incidentReadWhere, runbookReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../ai/redact';
import { resolveEmbeddingModel } from '../ai/port';
import { dot, normalizeVector } from '../semantic/vector';
import { withDbBudget } from '../jobs/db-budget';
import { detectCapabilities } from '../similarity/capabilities';
import {
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_SOURCE_KINDS,
  knowledgeTsQuery,
  factStaleBefore,
  PERSONAL_KNOWLEDGE_KINDS,
  reciprocalRankFusion,
  type KnowledgeSourceKindValue,
} from './contract';
import { getSquireMemorySettings } from './settings';

export type KnowledgeCitationKind = 'incident' | 'postmortem' | 'runbook' | 'service';

export interface KnowledgeSearchItem {
  chunkId: string;
  kind: KnowledgeSourceKindValue;
  title: string;
  text: string;
  /** The record this text came from, as a citable source the reader can open. */
  source: { kind: KnowledgeCitationKind; id: string; href: string };
  updatedAt: string;
  score: number;
}

export interface KnowledgeSearchResult {
  items: KnowledgeSearchItem[];
  /** Off: the index is switched off. Lexical: full-text/trigram only. Semantic: fused with embedding similarity. */
  coverage: 'OFF' | 'LEXICAL' | 'SEMANTIC';
}

interface Candidate {
  id: string;
  kind: KnowledgeSourceKindValue;
  sourceId: string;
  serviceId: string | null;
  incidentId: string | null;
  runbookId: string | null;
  title: string;
  text: string;
  sourceUpdatedAt: Date;
  embeddingModel: string | null;
  lexical: number;
}

const MAX_VECTOR_DIMS = 16_000;

let trigramAvailable: { value: boolean; at: number } | null = null;
async function hasTrigram(client: Prisma.TransactionClient): Promise<boolean> {
  if (trigramAvailable && Date.now() - trigramAvailable.at < 5 * 60_000)
    return trigramAvailable.value;
  const [row] = await client.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS present`;
  trigramAvailable = { value: Boolean(row?.present), at: Date.now() };
  return trigramAvailable.value;
}

/**
 * A coarse, index-friendly pre-filter: chunks of the reader's teams (by incident team or service team) plus
 * chunks with no team (runbooks, unowned services). It only narrows the candidates; visibility is decided
 * afterwards, source by source, through the application's own read rules.
 */
function scopeSql(actor: AuthorizationActor): Prisma.Sql {
  let global = false;
  try {
    global = Object.keys(incidentReadWhere(actor)).length === 0;
  } catch {
    global = false;
  }
  if (global) return Prisma.empty;
  const teams = [...actor.teamIds];
  return Prisma.sql`AND (c."teamId" = ANY(${teams}::text[]) OR c."teamId" IS NULL
    OR c."serviceId" IN (SELECT s.id FROM "Service" s WHERE s."teamId" = ANY(${teams}::text[])))`;
}

function sourceOf(candidate: Candidate): KnowledgeSearchItem['source'] | null {
  switch (candidate.kind) {
    case 'POSTMORTEM':
      return candidate.incidentId
        ? {
            kind: 'postmortem',
            id: candidate.incidentId,
            href: `/postmortems/${candidate.incidentId}`,
          }
        : null;
    case 'INCIDENT_NOTE':
    case 'RESOLUTION_NOTE':
      return candidate.incidentId
        ? { kind: 'incident', id: candidate.incidentId, href: `/incidents/${candidate.incidentId}` }
        : null;
    case 'RUNBOOK_STEP':
      return candidate.runbookId
        ? { kind: 'runbook', id: candidate.runbookId, href: `/runbooks/${candidate.runbookId}` }
        : null;
    case 'SERVICE_FACT':
      return candidate.serviceId
        ? { kind: 'service', id: candidate.serviceId, href: `/services/${candidate.serviceId}` }
        : null;
  }
}

async function readable<T extends { id: string }>(load: () => Promise<T[]>): Promise<Set<string>> {
  try {
    return new Set((await load()).map(row => row.id));
  } catch {
    // A denied role or an exhausted budget never makes a source readable.
    return new Set();
  }
}

/**
 * Searches the knowledge index as `actor` may see it. Lexical search (full text, then trigram for typos and
 * partial words) always works; when an embedding provider is configured and chunks carry vectors of the same
 * model, the visible candidates are re-ranked semantically. Every result is re-checked against its source
 * (incident, postmortem, runbook or service) through the reader's own visibility rules, so the index can never
 * reveal more than the application would.
 */
export async function searchKnowledgeForActor(
  actor: AuthorizationActor,
  input: {
    query: string;
    kinds?: readonly KnowledgeSourceKindValue[];
    serviceId?: string;
    personal: boolean;
    limit?: number;
    signal?: AbortSignal;
  }
): Promise<KnowledgeSearchResult> {
  if (actor.status !== 'ACTIVE') return { items: [], coverage: 'OFF' };
  if (!(await getSquireMemorySettings()).knowledgeEnabled) return { items: [], coverage: 'OFF' };
  const query = input.query.trim().slice(0, 300);
  const tsquery = knowledgeTsQuery(query);
  if (!tsquery) return { items: [], coverage: 'LEXICAL' };
  const kinds = (input.kinds?.length ? input.kinds : KNOWLEDGE_SOURCE_KINDS).filter(
    kind => input.personal || !PERSONAL_KNOWLEDGE_KINDS.has(kind)
  );
  if (kinds.length === 0) return { items: [], coverage: 'LEXICAL' };
  const limit = Math.max(1, Math.min(input.limit ?? KNOWLEDGE_LIMITS.resultLimit, 20));
  // Stale learned facts (not re-confirmed within the TTL) never reach a prompt.
  const service = Prisma.sql`${
    input.serviceId
      ? Prisma.sql`AND (c."serviceId" = ${input.serviceId} OR c."serviceId" IS NULL)`
      : Prisma.empty
  } AND (c."sourceKind" <> 'SERVICE_FACT' OR c."sourceUpdatedAt" >= ${factStaleBefore()})`;
  const scope = scopeSql(actor);
  const queryVector = await embedQuery(actor, query, input.signal);
  const vectorSearch =
    queryVector && (await detectCapabilities()).vectorAvailable ? queryVector : null;
  // Ranked by cosine similarity, best first: from the vector search, or the in-memory fallback below.
  let semantic: Array<{ id: string; cosine: number }> | null = null;

  const candidates = await withDbBudget({ maxDbMs: 1_500 }, async tx => {
    const lexical = await tx.$queryRaw<Array<Omit<Candidate, 'lexical'> & { rank: number }>>`
      SELECT c.id, c."sourceKind"::text AS kind, c."sourceId", c."serviceId", c."incidentId", c."runbookId",
        c.title, c.text, c."sourceUpdatedAt", c."embeddingModel",
        ts_rank_cd(c."searchVector", q)::float8 AS rank
      FROM "KnowledgeChunk" c, to_tsquery('simple', ${tsquery}) q
      WHERE c."searchVector" @@ q AND c."sourceKind"::text = ANY(${kinds}::text[]) ${service} ${scope}
      ORDER BY rank DESC, c."sourceUpdatedAt" DESC, c.id
      LIMIT ${KNOWLEDGE_LIMITS.candidateLimit}`;
    const top = Math.max(...lexical.map(row => row.rank), 0) || 1;
    const rows: Candidate[] = lexical.map(({ rank, ...row }) => ({ ...row, lexical: rank / top }));
    if (rows.length < limit && (await hasTrigram(tx))) {
      // Typos and partial words: nearest chunks by word similarity, through the trigram index.
      const fuzzy = await tx.$queryRaw<Array<Omit<Candidate, 'lexical'> & { similarity: number }>>`
        SELECT c.id, c."sourceKind"::text AS kind, c."sourceId", c."serviceId", c."incidentId", c."runbookId",
          c.title, c.text, c."sourceUpdatedAt", c."embeddingModel",
          word_similarity(${query}, c.text)::float8 AS similarity
        FROM "KnowledgeChunk" c
        WHERE ${query} <% c.text AND c."sourceKind"::text = ANY(${kinds}::text[]) ${service} ${scope}
        ORDER BY similarity DESC, c.id
        LIMIT ${KNOWLEDGE_LIMITS.candidateLimit}`;
      const seen = new Set(rows.map(row => row.id));
      for (const { similarity, ...row } of fuzzy)
        if (!seen.has(row.id)) rows.push({ ...row, lexical: 0.8 * similarity });
    }
    return rows;
  });
  if (vectorSearch) {
    // Vector candidates of their own, so a chunk that shares no words with the query can still be found.
    // Its own budget: a failure here leaves the lexical candidates standing.
    const size = Prisma.raw(String(vectorSearch.vector.length));
    const literal = `[${vectorSearch.vector.join(',')}]`;
    const nearest = await withDbBudget(
      { maxDbMs: 1_500 },
      tx =>
        tx.$queryRaw<Array<Omit<Candidate, 'lexical'> & { cosine: number }>>`
        SELECT c.id, c."sourceKind"::text AS kind, c."sourceId", c."serviceId", c."incidentId", c."runbookId",
          c.title, c.text, c."sourceUpdatedAt", c."embeddingModel",
          (1 - (c.embedding::vector(${size}) <=> ${literal}::vector(${size})))::float8 AS cosine
        FROM "KnowledgeChunk" c
        WHERE c."embeddingModel" = ${vectorSearch.model}
          AND array_length(c.embedding, 1) = ${vectorSearch.vector.length}
          AND c."sourceKind"::text = ANY(${kinds}::text[]) ${service} ${scope}
        ORDER BY c.embedding::vector(${size}) <=> ${literal}::vector(${size}), c.id
        LIMIT ${KNOWLEDGE_LIMITS.candidateLimit}`
    ).catch(() => []);
    const seen = new Set(candidates.map(row => row.id));
    semantic = [];
    for (const { cosine, ...row } of nearest) {
      if (!(cosine > 0)) continue;
      semantic.push({ id: row.id, cosine });
      if (!seen.has(row.id)) candidates.push({ ...row, lexical: 0 });
    }
  }
  if (candidates.length === 0) return { items: [], coverage: 'LEXICAL' };

  const ids = (pick: (candidate: Candidate) => string | null) => [
    ...new Set(candidates.map(pick).filter((id): id is string => Boolean(id))),
  ];
  const incidentIds = ids(c =>
    c.kind === 'POSTMORTEM' || c.kind === 'INCIDENT_NOTE' || c.kind === 'RESOLUTION_NOTE'
      ? c.incidentId
      : null
  );
  const runbookIds = ids(c => (c.kind === 'RUNBOOK_STEP' ? c.runbookId : null));
  const serviceIds = ids(c => (c.kind === 'SERVICE_FACT' ? c.serviceId : null));
  const [incidents, runbooks, services] = await Promise.all([
    incidentIds.length
      ? readable(() =>
          prisma.incident.findMany({
            where: { AND: [{ id: { in: incidentIds } }, incidentReadWhere(actor)] },
            select: { id: true },
          })
        )
      : new Set<string>(),
    runbookIds.length
      ? readable(() =>
          prisma.runbook.findMany({
            where: { AND: [{ id: { in: runbookIds }, archivedAt: null }, runbookReadWhere(actor)] },
            select: { id: true },
          })
        )
      : new Set<string>(),
    serviceIds.length
      ? readable(() =>
          prisma.service.findMany({
            where: { AND: [{ id: { in: serviceIds } }, serviceReadWhere(actor)] },
            select: { id: true },
          })
        )
      : new Set<string>(),
  ]);
  const visible = candidates.filter(candidate => {
    const source = sourceOf(candidate);
    if (!source) return false;
    if (source.kind === 'runbook') return runbooks.has(source.id);
    if (source.kind === 'service') return services.has(source.id);
    return incidents.has(source.id);
  });

  // Without pgvector, the lexical candidates are re-ranked by cosine in memory instead.
  if (queryVector && !vectorSearch)
    semantic = await cosineOf(queryVector, visible).catch(() => null);
  const visibleIds = new Set(visible.map(candidate => candidate.id));
  const lexicalOrder = visible
    .filter(candidate => candidate.lexical > 0)
    .sort((a, b) => b.lexical - a.lexical)
    .map(candidate => candidate.id);
  const semanticOrder = semantic?.filter(row => visibleIds.has(row.id)).map(row => row.id) ?? [];
  const fused = semanticOrder.length ? reciprocalRankFusion([lexicalOrder, semanticOrder]) : null;
  const ranked = visible
    .map(candidate => ({
      candidate,
      score: fused ? (fused.get(candidate.id) ?? 0) : Math.min(1, candidate.lexical),
    }))
    .sort(
      (a, b) => b.score - a.score || +b.candidate.sourceUpdatedAt - +a.candidate.sourceUpdatedAt
    )
    .slice(0, limit);

  return {
    coverage: fused ? 'SEMANTIC' : 'LEXICAL',
    items: ranked.map(({ candidate, score }) => ({
      chunkId: candidate.id,
      kind: candidate.kind,
      title: redactSecrets(candidate.title).slice(0, KNOWLEDGE_LIMITS.titleChars),
      text: shorten(redactSecrets(candidate.text), KNOWLEDGE_LIMITS.resultChars),
      source: sourceOf(candidate)!,
      updatedAt: candidate.sourceUpdatedAt.toISOString(),
      score: Math.round(score * 100) / 100,
    })),
  };
}

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The query's embedding, or null when no embedding provider is configured or no chunk carries its model. */
async function embedQuery(
  actor: AuthorizationActor,
  query: string,
  signal?: AbortSignal
): Promise<{ model: string; vector: number[] } | null> {
  try {
    const port = await resolveEmbeddingModel('PERSONAL');
    if (!port || signal?.aborted) return null;
    const indexed = await prisma.knowledgeChunk.findFirst({
      where: { embeddingModel: port.model },
      select: { id: true },
    });
    if (!indexed) return null;
    const { vectors } = await port.embed([query], { actorId: actor.id, signal });
    const vector = normalizeVector(vectors[0] ?? []);
    return vector && vector.length <= MAX_VECTOR_DIMS ? { model: port.model, vector } : null;
  } catch {
    // Semantic retrieval is an optional improvement; lexical results always stand on their own.
    return null;
  }
}

/** Cosine similarity of the visible candidates embedded with the same model, best first. */
async function cosineOf(
  query: { model: string; vector: number[] },
  candidates: Candidate[]
): Promise<Array<{ id: string; cosine: number }>> {
  const usable = candidates.filter(candidate => candidate.embeddingModel === query.model);
  if (usable.length === 0) return [];
  const rows = await prisma.knowledgeChunk.findMany({
    where: { id: { in: usable.map(candidate => candidate.id) }, embeddingModel: query.model },
    select: { id: true, embedding: true },
  });
  return rows
    .filter(row => row.embedding.length === query.vector.length)
    .map(row => ({ id: row.id, cosine: dot(query.vector, row.embedding) }))
    .filter(row => row.cosine > 0)
    .sort((a, b) => b.cosine - a.cosine);
}
