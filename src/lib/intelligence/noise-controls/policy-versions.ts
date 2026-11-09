import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  noiseControlDefinitionSchema,
  noiseScopeKey,
  type NoiseControlDefinition,
  type NoiseControlModeValue,
} from './contract';
import {
  diffNoiseControlVersions,
  noiseVersionChecksum,
  type NoiseVersionDiffEntry,
  type NoiseVersionOrigin,
} from './versioning';

/**
 * Storage side of noise-control policy versioning (pure parts live in `./versioning`).
 *
 * Model: `NoiseControlPolicy` stays the single live row the pre-paging cache reads, so the hot path is
 * unchanged. Every publish appends an immutable `NoiseControlPolicyVersion` and points
 * `activeVersionId` at it, inside the same transaction and under a per-scope advisory lock. A version is
 * "current" only while its `policyRevision` equals the row's `revision`; a row saved by a replica that
 * predates versioning (rolling deploy) or before the migration is captured as a BACKFILL version the
 * next time the scope is published, listed, or visited by the bounded sweep.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

export interface PolicyRowForVersioning {
  id: string;
  scopeKey: string;
  serviceId: string | null;
  mode: NoiseControlModeValue;
  definition: unknown;
  revision: number;
  activeVersionId: string | null;
  updatedById: string | null;
}

export const NOISE_VERSION_BACKFILL_LIMITS = { batchSize: 100, maxBatches: 5 } as const;

/** Serializes publishes, rollbacks and backfill captures for one scope. */
export async function lockNoiseScope(tx: Tx, scopeKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`noise-policy:${scopeKey}`}, 0))`;
}

async function nextVersionNumber(tx: Tx, scopeKey: string): Promise<number> {
  const aggregate = await tx.noiseControlPolicyVersion.aggregate({
    where: { scopeKey },
    _max: { versionNumber: true },
  });
  return (aggregate._max.versionNumber ?? 0) + 1;
}

async function appendVersion(
  tx: Tx,
  row: PolicyRowForVersioning,
  options: { origin: NoiseVersionOrigin; actorId: string | null; sourceVersionId?: string | null }
) {
  const version = await tx.noiseControlPolicyVersion.create({
    data: {
      scopeKey: row.scopeKey,
      serviceId: row.serviceId,
      versionNumber: await nextVersionNumber(tx, row.scopeKey),
      mode: row.mode,
      definition: row.definition as Prisma.InputJsonValue,
      checksum: noiseVersionChecksum(row.mode, row.definition),
      policyRevision: row.revision,
      origin: options.origin,
      sourceVersionId: options.sourceVersionId ?? null,
      publishedById: options.actorId,
    },
    select: { id: true, versionNumber: true },
  });
  // Fenced on revision: if a pre-versioning replica rewrote the row meanwhile, the pointer is left alone
  // and the next capture records that newer state.
  await tx.noiseControlPolicy.updateMany({
    where: { id: row.id, revision: row.revision },
    data: { activeVersionId: version.id },
  });
  return version;
}

/**
 * Returns the version that matches the row's current revision, capturing one (origin BACKFILL) when the
 * row has none or its pointer is stale. Caller holds `lockNoiseScope`.
 */
export async function ensureCurrentVersion(
  tx: Tx,
  row: PolicyRowForVersioning
): Promise<{ id: string; versionNumber: number; captured: boolean }> {
  if (row.activeVersionId) {
    const active = await tx.noiseControlPolicyVersion.findUnique({
      where: { id: row.activeVersionId },
      select: { id: true, versionNumber: true, policyRevision: true },
    });
    if (active && active.policyRevision === row.revision)
      return { id: active.id, versionNumber: active.versionNumber, captured: false };
  }
  const version = await appendVersion(tx, row, {
    origin: 'BACKFILL',
    actorId: row.updatedById,
  });
  return { ...version, captured: true };
}

/** Appends the version for a row that was just written by a publish or a rollback. */
export async function recordPublishedVersion(
  tx: Tx,
  row: PolicyRowForVersioning,
  options: { origin: 'PUBLISH' | 'ROLLBACK'; actorId: string; sourceVersionId?: string | null }
) {
  return appendVersion(tx, row, options);
}

/**
 * Bounded, idempotent backfill: captures a version for every policy row with no current version.
 * Keyset-paged by id, one short transaction per row under the scope lock, at most
 * `batchSize * maxBatches` rows per call. Safe to run on every sweep and on several replicas at once.
 */
export async function backfillNoiseControlPolicyVersions(
  options: { batchSize?: number; maxBatches?: number } = {},
  client: typeof prisma = prisma
): Promise<{ scanned: number; captured: number; complete: boolean }> {
  const batchSize = Math.min(
    Math.max(options.batchSize ?? NOISE_VERSION_BACKFILL_LIMITS.batchSize, 1),
    500
  );
  const maxBatches = Math.min(
    Math.max(options.maxBatches ?? NOISE_VERSION_BACKFILL_LIMITS.maxBatches, 1),
    50
  );
  let cursor = '';
  let scanned = 0;
  let captured = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const pending = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p."id" FROM "NoiseControlPolicy" p
      LEFT JOIN "NoiseControlPolicyVersion" v ON v."id" = p."activeVersionId"
      WHERE p."id" > ${cursor} AND (v."id" IS NULL OR v."policyRevision" <> p."revision")
      ORDER BY p."id" ASC LIMIT ${batchSize}`);
    if (!pending.length) return { scanned, captured, complete: true };
    for (const { id } of pending) {
      scanned += 1;
      try {
        const result = await client.$transaction(async tx => {
          const probe = await tx.noiseControlPolicy.findUnique({
            where: { id },
            select: { scopeKey: true },
          });
          if (!probe) return false;
          await lockNoiseScope(tx, probe.scopeKey);
          const row = await tx.noiseControlPolicy.findUnique({ where: { id } });
          if (!row) return false;
          return (await ensureCurrentVersion(tx, row)).captured;
        });
        if (result) captured += 1;
      } catch (error) {
        logger.warn('[Intelligence] Noise policy version backfill skipped a row', {
          policyId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    cursor = pending[pending.length - 1]!.id;
    if (pending.length < batchSize) return { scanned, captured, complete: true };
  }
  return { scanned, captured, complete: false };
}

export interface NoiseControlVersionView {
  id: string;
  versionNumber: number;
  mode: NoiseControlModeValue;
  origin: NoiseVersionOrigin;
  checksum: string;
  policyRevision: number;
  publishedAt: Date;
  publishedById: string | null;
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  /** The version the live policy (and the pre-paging cache) is running. */
  active: boolean;
  orchestrationRuleCount: number;
  /** Differences from the previous version (empty for the first one). */
  changes: NoiseVersionDiffEntry[];
  /** What a rollback to this version would change relative to the active one (empty when active). */
  changesFromActive: NoiseVersionDiffEntry[];
}

function definitionOf(raw: unknown): NoiseControlDefinition | null {
  const parsed = noiseControlDefinitionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Version history for one scope, newest first. Captures the live row first when it has no current
 * version (so history always ends at what is running), then pages `limit` versions plus one more to diff
 * the oldest listed version against its predecessor.
 */
export async function listNoiseControlPolicyVersions(
  serviceId: string | null,
  options: { limit?: number; beforeVersion?: number } = {},
  client: typeof prisma = prisma
): Promise<NoiseControlVersionView[]> {
  const scopeKey = noiseScopeKey(serviceId);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  let policy = await client.noiseControlPolicy.findUnique({ where: { scopeKey } });
  if (policy) {
    const current = policy.activeVersionId
      ? await client.noiseControlPolicyVersion.findUnique({
          where: { id: policy.activeVersionId },
          select: { policyRevision: true },
        })
      : null;
    if (!current || current.policyRevision !== policy.revision) {
      await client.$transaction(async tx => {
        await lockNoiseScope(tx, scopeKey);
        const row = await tx.noiseControlPolicy.findUnique({ where: { scopeKey } });
        if (row) await ensureCurrentVersion(tx, row);
      });
      policy = await client.noiseControlPolicy.findUnique({ where: { scopeKey } });
    }
  }
  const rows = await client.noiseControlPolicyVersion.findMany({
    where: {
      scopeKey,
      ...(options.beforeVersion ? { versionNumber: { lt: options.beforeVersion } } : {}),
    },
    orderBy: { versionNumber: 'desc' },
    take: limit + 1,
  });
  const activeId = policy?.activeVersionId ?? null;
  const active =
    rows.find(row => row.id === activeId) ??
    (activeId
      ? await client.noiseControlPolicyVersion.findUnique({ where: { id: activeId } })
      : null);
  const sourceIds = [...new Set(rows.map(row => row.sourceVersionId).filter(Boolean))] as string[];
  const sources = sourceIds.length
    ? await client.noiseControlPolicyVersion.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, versionNumber: true },
      })
    : [];
  const sourceNumbers = new Map(sources.map(source => [source.id, source.versionNumber]));
  return rows.slice(0, limit).map((row, index) => {
    const definition = definitionOf(row.definition);
    const previous = rows[index + 1];
    const subject = { mode: row.mode, definition };
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      mode: row.mode,
      origin: row.origin as NoiseVersionOrigin,
      checksum: row.checksum,
      policyRevision: row.policyRevision,
      publishedAt: row.publishedAt,
      publishedById: row.publishedById,
      sourceVersionId: row.sourceVersionId,
      sourceVersionNumber: row.sourceVersionId
        ? (sourceNumbers.get(row.sourceVersionId) ?? null)
        : null,
      active: row.id === activeId,
      orchestrationRuleCount: definition?.orchestration.rules.length ?? 0,
      changes: previous
        ? diffNoiseControlVersions(
            { mode: previous.mode, definition: definitionOf(previous.definition) },
            subject
          )
        : [],
      changesFromActive:
        active && active.id !== row.id
          ? diffNoiseControlVersions(
              { mode: active.mode, definition: definitionOf(active.definition) },
              subject
            )
          : [],
    };
  });
}

/** Any two versions of the same scope, for the API and the settings diff view. */
export async function compareNoiseControlVersions(
  fromVersionId: string,
  toVersionId: string,
  client: Client = prisma
): Promise<{
  from: { id: string; versionNumber: number };
  to: { id: string; versionNumber: number };
  changes: NoiseVersionDiffEntry[];
} | null> {
  const rows = await client.noiseControlPolicyVersion.findMany({
    where: { id: { in: [fromVersionId, toVersionId] } },
  });
  const from = rows.find(row => row.id === fromVersionId);
  const to = rows.find(row => row.id === toVersionId);
  if (!from || !to || from.scopeKey !== to.scopeKey) return null;
  return {
    from: { id: from.id, versionNumber: from.versionNumber },
    to: { id: to.id, versionNumber: to.versionNumber },
    changes: diffNoiseControlVersions(
      { mode: from.mode, definition: definitionOf(from.definition) },
      { mode: to.mode, definition: definitionOf(to.definition) }
    ),
  };
}
