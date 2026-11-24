import 'server-only';
import { Prisma, type KnowledgeDocSource } from '@prisma/client';
import { Agent } from 'undici';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { decrypt } from '@/lib/encryption';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { assertSafeOutboundUrl, safeOutboundLookup } from '@/lib/network-security';
import { redactSecrets } from '../../ai/redact';
import { KNOWLEDGE_LIMITS, knowledgeTsQuery } from '../../memory/contract';
import { getSquireMemorySettings, squireKnowledgeEnabled } from '../../memory/settings';
import {
  archiveRequest,
  DOC_SOURCE_LIMITS,
  DocSourceError,
  documentChunks,
  documentHref,
  extractDocuments,
  normalizeDocFolder,
  type ExtractedDocument,
} from './archive';

// Same socket-level address check as safeOutboundFetch, which refuses every redirect: GitHub answers a tarball
// request with a redirect to its download host, so each hop is validated here instead.
const dispatcher = new Agent({ connect: { lookup: safeOutboundLookup } });
const MAX_REDIRECTS = 3;

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  const tooLarge = () => new DocSourceError('The archive is larger than 20 MB.');
  if (Number(response.headers.get('content-length') ?? 0) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads an archive over HTTPS from public addresses only, following at most three redirects (each one
 * re-checked), within one timeout and the archive size limit. A credential never follows a redirect to
 * another host. Errors are DocSourceErrors whose message never contains the URL.
 */
export async function downloadArchive(
  url: string,
  headers: Record<string, string>
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOC_SOURCE_LIMITS.fetchTimeoutMs);
  let current = url;
  let sent = headers;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = await assertSafeOutboundUrl(current, { requireHttps: true }).catch(() => {
        throw new DocSourceError('Only HTTPS addresses on the public internet are allowed.');
      });
      const response = await fetch(target, {
        headers: sent,
        redirect: 'manual',
        signal: controller.signal,
        dispatcher,
      } as RequestInit);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        if (!location) throw new DocSourceError(`The server answered HTTP ${response.status}.`);
        const next = new URL(location, target);
        if (next.origin !== target.origin) sent = {};
        current = next.toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new DocSourceError(`The server answered HTTP ${response.status}.`);
      }
      return await readBounded(response, DOC_SOURCE_LIMITS.archiveBytes);
    }
    throw new DocSourceError('Too many redirects.');
  } catch (error) {
    if (error instanceof DocSourceError) throw error;
    if (controller.signal.aborted) throw new DocSourceError('The download timed out.');
    throw new DocSourceError('The archive could not be downloaded.');
  } finally {
    clearTimeout(timer);
  }
}

const sourcePrefix = (sourceId: string) => `${sourceId}/`;

/**
 * Replaces a source's chunks with those of `documents` in one transaction. Unchanged chunks (same file, index
 * and content hash) are kept, so they keep their embeddings; everything else is removed or added.
 */
async function replaceDocumentChunks(
  source: Pick<KnowledgeDocSource, 'id' | 'teamId'>,
  documents: ExtractedDocument[],
  now: Date
): Promise<void> {
  const prefix = sourcePrefix(source.id);
  const drafts = documents.flatMap(document =>
    documentChunks(document.path, document.text).map(chunk => ({
      ...chunk,
      sourceId: prefix + document.path,
    }))
  );
  const key = (row: { sourceId: string; chunkIndex: number; contentHash: string }) =>
    `${row.sourceId}\u0000${row.chunkIndex}\u0000${row.contentHash}`;
  await prisma.$transaction(
    async tx => {
      const existing = await tx.knowledgeChunk.findMany({
        where: { sourceKind: 'DOCUMENT', sourceId: { startsWith: prefix } },
        select: { id: true, sourceId: true, chunkIndex: true, contentHash: true },
      });
      const wanted = new Set(drafts.map(key));
      const kept = new Set(existing.map(key));
      const stale = existing.filter(row => !wanted.has(key(row))).map(row => row.id);
      for (let index = 0; index < stale.length; index += 1_000)
        await tx.knowledgeChunk.deleteMany({
          where: { id: { in: stale.slice(index, index + 1_000) } },
        });
      const fresh = drafts.filter(draft => !kept.has(key(draft)));
      for (let index = 0; index < fresh.length; index += 500)
        await tx.knowledgeChunk.createMany({
          data: fresh.slice(index, index + 500).map(draft => ({
            sourceKind: 'DOCUMENT' as const,
            sourceId: draft.sourceId,
            chunkIndex: draft.chunkIndex,
            title: draft.title,
            text: draft.text,
            contentHash: draft.contentHash,
            teamId: source.teamId,
            sourceCreatedAt: now,
            sourceUpdatedAt: now,
          })),
        });
    },
    { timeout: 120_000 }
  );
}

export interface DocSyncResult {
  ok: boolean;
  documentCount: number;
  error?: string;
}

/**
 * Downloads one source, extracts its documents and replaces its chunks, recording the outcome on the source.
 * Returns null when another sync of the same source is still running.
 */
export async function syncDocSource(id: string, now = new Date()): Promise<DocSyncResult | null> {
  const claimed = await prisma.knowledgeDocSource.updateMany({
    where: {
      id,
      OR: [
        { lastStatus: null },
        { lastStatus: { not: 'SYNCING' } },
        // A sync that died mid-way is taken over once it is clearly abandoned.
        { updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
      ],
    },
    data: { lastStatus: 'SYNCING' },
  });
  if (claimed.count === 0) return null;
  const source = await prisma.knowledgeDocSource.findUniqueOrThrow({ where: { id } });
  try {
    const token = source.tokenEncrypted ? await decrypt(source.tokenEncrypted) : null;
    const request = archiveRequest(source, token);
    const documents = extractDocuments(await downloadArchive(request.url, request.headers), {
      stripTopFolder: source.kind === 'GIT',
      folder: normalizeDocFolder(source.path),
    });
    await replaceDocumentChunks(source, documents, now);
    await prisma.knowledgeDocSource.update({
      where: { id },
      data: {
        lastStatus: 'OK',
        lastError: null,
        lastSyncedAt: now,
        documentCount: documents.length,
      },
    });
    return { ok: true, documentCount: documents.length };
  } catch (error) {
    const message = error instanceof DocSourceError ? error.message : 'The sync failed.';
    if (!(error instanceof DocSourceError))
      logger.warn('[Squire] Documentation source sync failed', {
        sourceId: id,
        error: error instanceof Error ? error.name : 'error',
      });
    await prisma.knowledgeDocSource
      .update({
        where: { id },
        data: { lastStatus: 'FAILED', lastError: message, lastSyncedAt: now },
      })
      .catch(() => undefined);
    return { ok: false, documentCount: source.documentCount, error: message };
  }
}

/** Scheduled: syncs the one enabled source that is most overdue, while the knowledge index is on. */
export async function syncDueDocSource(now = new Date()): Promise<DocSyncResult | null> {
  if (!(await squireKnowledgeEnabled())) return null;
  const due = await prisma.knowledgeDocSource.findFirst({
    where: {
      enabled: true,
      OR: [
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: new Date(now.getTime() - DOC_SOURCE_LIMITS.syncIntervalMs) } },
      ],
    },
    orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    select: { id: true },
  });
  return due ? syncDocSource(due.id, now) : null;
}

/** Removes a source and every chunk it wrote. */
export async function deleteDocSource(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.knowledgeChunk.deleteMany({
      where: { sourceKind: 'DOCUMENT', sourceId: { startsWith: sourcePrefix(id) } },
    }),
    prisma.knowledgeDocSource.deleteMany({ where: { id } }),
  ]);
}

export interface DocumentSearchItem {
  chunkId: string;
  kind: 'DOCUMENT';
  title: string;
  text: string;
  /** The document as a citable source: its path, and a link to the file (or the archive it came from). */
  source: { kind: 'document'; id: string; name: string; path: string; href: string };
  updatedAt: string;
  score: number;
}

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Full-text search over the organisation's documentation, as `actor` may read it: a source scoped to a team is
 * read only by that team's members (and by people who read every team's incidents). Visibility comes from the
 * source row, not the chunk, and a disabled source is never searched.
 */
export async function searchDocumentsForActor(
  actor: AuthorizationActor,
  query: string,
  limit: number = KNOWLEDGE_LIMITS.resultLimit
): Promise<DocumentSearchItem[]> {
  if (actor.status !== 'ACTIVE') return [];
  const tsquery = knowledgeTsQuery(query.trim().slice(0, 300));
  if (!tsquery || !(await getSquireMemorySettings()).knowledgeEnabled) return [];
  let everyTeam = false;
  try {
    everyTeam = Object.keys(incidentReadWhere(actor)).length === 0;
  } catch {
    everyTeam = false;
  }
  const scope = everyTeam
    ? Prisma.empty
    : Prisma.sql`AND (s."teamId" IS NULL OR s."teamId" = ANY(${[...actor.teamIds]}::text[]))`;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      sourceId: string;
      title: string;
      text: string;
      sourceUpdatedAt: Date;
      docSourceId: string;
      name: string;
      kind: string;
      url: string;
      ref: string | null;
      rank: number;
    }>
  >`
    SELECT c.id, c."sourceId", c.title, c.text, c."sourceUpdatedAt", s.id AS "docSourceId", s.name, s.kind,
      s.url, s.ref, ts_rank_cd(c."searchVector", q)::float8 AS rank
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDocSource" s ON s.id = split_part(c."sourceId", '/', 1)
    CROSS JOIN to_tsquery('simple', ${tsquery}) q
    WHERE c."sourceKind"::text = 'DOCUMENT' AND s.enabled AND c."searchVector" @@ q ${scope}
    ORDER BY rank DESC, c."sourceUpdatedAt" DESC, c.id
    LIMIT ${Math.max(1, Math.min(limit, 20))}`;
  const top = Math.max(...rows.map(row => row.rank), 0) || 1;
  return rows.map(row => {
    const path = row.sourceId.slice(row.docSourceId.length + 1);
    return {
      chunkId: row.id,
      kind: 'DOCUMENT',
      title: redactSecrets(row.title).slice(0, KNOWLEDGE_LIMITS.titleChars),
      text: shorten(redactSecrets(row.text), KNOWLEDGE_LIMITS.resultChars),
      source: {
        kind: 'document',
        id: row.docSourceId,
        name: row.name,
        path,
        href: documentHref(row, path),
      },
      updatedAt: row.sourceUpdatedAt.toISOString(),
      score: Math.round((row.rank / top) * 100) / 100,
    };
  });
}
