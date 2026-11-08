import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { incidentReadWhere, runbookReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../ai/redact';
import { resolveEmbeddingModel } from '../ai/port';
import { dot, normalizeVector } from '../semantic/vector';
import { withDbBudget } from '../jobs/db-budget';
import {
  blendKnowledgeScore,
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_SOURCE_KINDS,
  knowledgeTsQuery,
  PERSONAL_KNOWLEDGE_KINDS,
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
  /** Off: the index is switched off. Lexical: full-text/trigram only. Semantic: re-ranked with embeddings. */
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
  const service = input.serviceId
    ? Prisma.sql`AND (c."serviceId" = ${input.serviceId} OR c."serviceId" IS NULL)`
    : Prisma.empty;
  const scope = scopeSql(actor);

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

  const semantic = await semanticScores(actor, query, visible, input.signal);
  const ranked = visible
    .map(candidate => ({
      candidate,
      score: blendKnowledgeScore(
        candidate.lexical,
        semantic?.get(candidate.id) ?? (semantic ? 0 : null)
      ),
    }))
    .sort(
      (a, b) => b.score - a.score || +b.candidate.sourceUpdatedAt - +a.candidate.sourceUpdatedAt
    )
    .slice(0, limit);

  return {
    coverage: semantic ? 'SEMANTIC' : 'LEXICAL',
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

/** Cosine similarity per visible candidate, or null when no compatible embedding provider is configured. */
async function semanticScores(
  actor: AuthorizationActor,
  query: string,
  candidates: Candidate[],
  signal?: AbortSignal
): Promise<Map<string, number> | null> {
  if (candidates.length === 0 || !candidates.some(c => c.embeddingModel)) return null;
  try {
    const port = await resolveEmbeddingModel('PERSONAL');
    if (!port || signal?.aborted) return null;
    const usable = candidates.filter(candidate => candidate.embeddingModel === port.model);
    if (usable.length === 0) return null;
    const { vectors } = await port.embed([query], { actorId: actor.id, signal });
    const vector = normalizeVector(vectors[0] ?? []);
    if (!vector) return null;
    const rows = await prisma.knowledgeChunk.findMany({
      where: { id: { in: usable.map(candidate => candidate.id) }, embeddingModel: port.model },
      select: { id: true, embedding: true },
    });
    return new Map(rows.map(row => [row.id, Math.max(0, dot(vector, row.embedding))]));
  } catch {
    // The semantic re-rank is an optional improvement; lexical results always stand on their own.
    return null;
  }
}
