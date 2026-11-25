import 'server-only';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

/**
 * Traces and metrics are not ingested per service pair anywhere in this codebase, so measured
 * traffic arrives through this endpoint's payload instead (pushed from a collector or script).
 */
export const MAX_EDGE_STATS_BATCH = 200;
const id = z.string().trim().min(1).max(100);
export const edgeStatsBatchSchema = z
  .object({
    source: z.string().trim().min(1).max(64),
    stats: z
      .array(
        z
          .object({
            upstreamServiceId: id,
            downstreamServiceId: id,
            windowStart: z.string().datetime(),
            windowSeconds: z.number().int().min(10).max(86_400),
            requestCount: z.number().int().min(0).max(2_000_000_000),
            errorCount: z.number().int().min(0).max(2_000_000_000),
          })
          .strict()
          .refine(v => v.errorCount <= v.requestCount, 'errorCount cannot exceed requestCount')
          .refine(v => v.upstreamServiceId !== v.downstreamServiceId, 'A service is not its own dependency')
      )
      .min(1)
      .max(MAX_EDGE_STATS_BATCH),
  })
  .strict();
export type EdgeStatsBatch = z.infer<typeof edgeStatsBatchSchema>;

const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 7 * 864e5;

/** Idempotent: a window for a pair and source is upserted, so a retry changes nothing. */
export async function ingestEdgeStats(actor: AuthorizationActor, batch: EdgeStatsBatch) {
  const now = Date.now();
  const serviceIds = [...new Set(batch.stats.flatMap(s => [s.upstreamServiceId, s.downstreamServiceId]))];
  const known = new Set(
    (
      await prisma.service.findMany({
        where: { AND: [{ id: { in: serviceIds } }, serviceReadWhere(actor)] },
        select: { id: true },
      })
    ).map(row => row.id)
  );
  // Only pairs that are declared or observed edges are accepted: no stats for undeclared links.
  const pairs = await prisma.serviceDependency.findMany({
    where: {
      status: 'ACTIVE',
      upstreamServiceId: { in: serviceIds },
      downstreamServiceId: { in: serviceIds },
    },
    select: { upstreamServiceId: true, downstreamServiceId: true },
  });
  const edges = new Set(pairs.map(p => `${p.upstreamServiceId}>${p.downstreamServiceId}`));
  let accepted = 0;
  const rejected: Array<{ index: number; reason: string }> = [];
  for (const [index, stat] of batch.stats.entries()) {
    const start = new Date(stat.windowStart).getTime();
    const reason = !known.has(stat.upstreamServiceId) || !known.has(stat.downstreamServiceId)
      ? 'UNKNOWN_SERVICE'
      : !edges.has(`${stat.upstreamServiceId}>${stat.downstreamServiceId}`)
        ? 'NO_ACTIVE_DEPENDENCY'
        : start > now + FUTURE_SKEW_MS || start < now - MAX_AGE_MS
          ? 'WINDOW_OUT_OF_RANGE'
          : null;
    if (reason) {
      rejected.push({ index, reason });
      continue;
    }
    const data = {
      windowSeconds: stat.windowSeconds,
      requestCount: stat.requestCount,
      errorCount: stat.errorCount,
    };
    await prisma.serviceDependencyEdgeStats.upsert({
      where: {
        upstreamServiceId_downstreamServiceId_source_windowStart: {
          upstreamServiceId: stat.upstreamServiceId,
          downstreamServiceId: stat.downstreamServiceId,
          source: batch.source,
          windowStart: new Date(start),
        },
      },
      create: {
        upstreamServiceId: stat.upstreamServiceId,
        downstreamServiceId: stat.downstreamServiceId,
        source: batch.source,
        windowStart: new Date(start),
        ...data,
      },
      update: data,
    });
    accepted += 1;
  }
  if (accepted === 0 && rejected.length === batch.stats.length)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'stats', code: 'custom', message: `No stat was accepted (${rejected[0].reason}).` }],
    });
  return { accepted, rejected };
}

export interface EdgeTraffic {
  requestRate: number;
  errorRate: number;
  windowStart: string;
}

/** Latest window per edge, as requests per second and the error share. Pairs without stats are absent. */
export async function loadEdgeTraffic(
  edges: ReadonlyArray<{ upstreamServiceId: string; downstreamServiceId: string }>
): Promise<Map<string, EdgeTraffic>> {
  const ids = [...new Set(edges.flatMap(e => [e.upstreamServiceId, e.downstreamServiceId]))];
  const rows = await prisma.serviceDependencyEdgeStats.findMany({
    where: {
      upstreamServiceId: { in: ids },
      downstreamServiceId: { in: ids },
      windowStart: { gte: new Date(Date.now() - MAX_AGE_MS) },
    },
    orderBy: { windowStart: 'desc' },
    take: 5000,
  });
  const wanted = new Set(edges.map(e => `${e.upstreamServiceId}>${e.downstreamServiceId}`));
  const result = new Map<string, EdgeTraffic>();
  for (const row of rows) {
    const key = `${row.upstreamServiceId}>${row.downstreamServiceId}`;
    if (!wanted.has(key) || result.has(key)) continue;
    result.set(key, {
      requestRate: row.requestCount / row.windowSeconds,
      errorRate: row.requestCount ? row.errorCount / row.requestCount : 0,
      windowStart: row.windowStart.toISOString(),
    });
  }
  return result;
}
