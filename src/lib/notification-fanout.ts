import crypto from 'node:crypto';
import type { NotificationTrafficClass } from '@prisma/client';
import prisma from './prisma';
import { encrypt } from './encryption';
import { addOperationalMetric } from './metrics/operational/registry';
import { getEffectiveWatermarks as resolverWatermarks } from './notification-capacity/resolver';

const DEFAULT_LOW_WATERMARK = 5_000;
const DEFAULT_HIGH_WATERMARK = 25_000;

function boundedSetting(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 1_000_000 ? parsed : fallback;
}

/** Legacy env-only watermarks. Prefer `getEffectiveFanoutWatermarks()` (DB > env > default). */
export function fanoutWatermarks(env: NodeJS.ProcessEnv = process.env) {
  const low = boundedSetting(env.NOTIFICATION_BULK_QUEUE_LOW_WATERMARK, DEFAULT_LOW_WATERMARK);
  const high = boundedSetting(env.NOTIFICATION_BULK_QUEUE_HIGH_WATERMARK, DEFAULT_HIGH_WATERMARK);
  return { low, high: Math.max(low, high) };
}

export async function getEffectiveFanoutWatermarks() {
  return resolverWatermarks();
}

const BULK_BACKPRESSURE_KEY = 'notification_bulk_backpressure';

export type BulkBackpressureState = 'NORMAL' | 'PAUSED';

/**
 * Durable backpressure signal. Unlike a plain Error this tells the job
 * processor to reschedule without consuming a retry attempt so a large
 * fanout campaign survives temporary queue saturation.
 */
export class BulkQueueBackpressureError extends Error {
  constructor() {
    super('Bulk notification queue reached its high watermark');
    this.name = 'BulkQueueBackpressureError';
  }
}

export async function getBulkBackpressureState(): Promise<BulkBackpressureState> {
  const record = await prisma.systemConfig.findUnique({ where: { key: BULK_BACKPRESSURE_KEY } });
  const value =
    record?.value && typeof record.value === 'object' && !Array.isArray(record.value)
      ? (record.value as Record<string, unknown>)
      : null;
  return value?.state === 'PAUSED' ? 'PAUSED' : 'NORMAL';
}

export async function setBulkBackpressureState(state: BulkBackpressureState): Promise<void> {
  const value = { state, updatedAt: new Date().toISOString() };
  await prisma.systemConfig.upsert({
    where: { key: BULK_BACKPRESSURE_KEY },
    create: { key: BULK_BACKPRESSURE_KEY, value },
    update: { value },
  });
}

export function resetBulkBackpressureForTests() {
  // No in-process cache — DB is the source of truth. Tests reset via prisma mock.
}

/**
 * COUNT coalescer — many concurrent bulkQueueHasCapacity/getBulkQueueHealth
 * callers (parallel campaign loops, queue workers) share one in-flight COUNT.
 * Short TTL collapses bursts under large tables without stale backpressure.
 */
const BULK_DEPTH_COALESCE_MS = 750;
type DepthCache = { depth: number; at: number; inflight: Promise<number> | null };
const bulkDepthCache: DepthCache = { depth: 0, at: 0, inflight: null };

function isRetryableBulkWhere(now: Date) {
  return {
    trafficClass: { in: ['PUBLIC_INCIDENT', 'BULK'] as const },
    // Count only deliverable bulk: PENDING (active payload) OR FAILED retryable.
    // Terminal FAILED (attempts>=maxAttempts or payloadEncrypted wiped, or expired
    // or nextAttemptAt in future) is dead-letter and must not gate fanout.
    OR: [
      { status: 'PENDING' as const, payloadEncrypted: { not: null } },
      {
        status: 'FAILED' as const,
        payloadEncrypted: { not: null },
        // Prisma doesn't support column-vs-column (attempts < maxAttempts) in
        // where — approximate with attempts < 20 (hard ceiling) so terminal rows
        // aren't counted. True predicate lives in the worker claim query.
        attempts: { lt: 20 },
        nextAttemptAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    ],
  } as const;
}

export async function getDeliverableBulkDepth(now = new Date()): Promise<number> {
  const staleAt = bulkDepthCache.at + BULK_DEPTH_COALESCE_MS;
  if (Date.now() < staleAt) return bulkDepthCache.depth;
  if (bulkDepthCache.inflight) return bulkDepthCache.inflight;
  const where = isRetryableBulkWhere(now);
  const p = prisma.notification
    .count({ where: where as never })
    .then(depth => {
      bulkDepthCache.depth = depth;
      bulkDepthCache.at = Date.now();
      bulkDepthCache.inflight = null;
      return depth;
    })
    .catch(err => {
      bulkDepthCache.inflight = null;
      throw err;
    });
  bulkDepthCache.inflight = p;
  return p;
}

export function resetBulkDepthCacheForTests() {
  bulkDepthCache.depth = 0;
  bulkDepthCache.at = 0;
  bulkDepthCache.inflight = null;
}

export async function getBulkQueueHealth(): Promise<{
  depth: number;
  low: number;
  high: number;
  source: string;
  revision: number | null;
  state: BulkBackpressureState;
  hasCapacity: boolean;
}> {
  const watermarks = await resolverWatermarks();
  const now = new Date();
  const depth = await getDeliverableBulkDepth(now);
  const state = await getBulkBackpressureState();
  // Hysteresis: PAUSED persists until depth drains below low.
  const hasCapacity = state === 'PAUSED' ? depth < watermarks.low : depth < watermarks.high;
  return {
    depth,
    low: watermarks.low,
    high: watermarks.high,
    source: watermarks.source,
    revision: watermarks.revision,
    state,
    hasCapacity,
  };
}

export async function bulkQueueHasCapacity(now = new Date()): Promise<boolean> {
  const { low, high } = await resolverWatermarks();
  const depth = await getDeliverableBulkDepth(now);
  const state = await getBulkBackpressureState();
  if (state === 'PAUSED') {
    if (depth < low) {
      await setBulkBackpressureState('NORMAL');
      // Invalidate coalesced COUNT so next caller sees drained depth immediately.
      bulkDepthCache.at = 0;
      bulkDepthCache.inflight = null;
      return true;
    }
    return false;
  }
  if (depth >= high) {
    await setBulkBackpressureState('PAUSED');
    bulkDepthCache.at = 0;
    bulkDepthCache.inflight = null;
    return false;
  }
  return true;
}

export async function beginNotificationFanout(input: {
  statusPageId: string;
  sourceType: string;
  sourceId: string;
  eventKey: string;
  trafficClass: NotificationTrafficClass;
  providerKey?: string;
  subject: string;
  html: string;
}) {
  const contentHash = crypto
    .createHash('sha256')
    .update(`${input.subject}\u001f${input.html}`)
    .digest('hex');
  const content = await prisma.notificationContent.upsert({
    where: { contentHash },
    create: {
      contentHash,
      subject: input.subject,
      encryptedTemplate: await encrypt(input.html),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000),
    },
    update: {},
  });
  return prisma.notificationFanout.upsert({
    where: {
      statusPageId_sourceType_sourceId_eventKey: {
        statusPageId: input.statusPageId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        eventKey: input.eventKey,
      },
    },
    create: {
      statusPageId: input.statusPageId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventKey: input.eventKey,
      trafficClass: input.trafficClass,
      providerKey: input.providerKey,
      contentId: content.id,
      status: 'RUNNING',
      startedAt: new Date(),
    },
    update: {},
    include: { content: true },
  });
}

export async function recordFanoutPage(
  fanoutId: string,
  input: { cursor?: string; materialized: number; failed: number; complete: boolean }
) {
  const fanout = await prisma.notificationFanout.update({
    where: { id: fanoutId },
    data: {
      ...(input.cursor ? { cursor: input.cursor } : {}),
      materializedTargets: { increment: input.materialized },
      failedTargets: { increment: input.failed },
      ...(input.complete ? { status: 'COMPLETED', completedAt: new Date() } : {}),
    },
  });
  addOperationalMetric('opsknight_status_fanout_materialized', input.materialized, {
    traffic_class: fanout.trafficClass,
  });
  addOperationalMetric('opsknight_status_fanout_failed', input.failed, {
    traffic_class: fanout.trafficClass,
  });
  if (input.complete) {
    addOperationalMetric('opsknight_status_fanout_campaign_total', 1, { outcome: 'completed' });
  }
  return fanout;
}

export async function cleanupExpiredNotificationCapacityData(now = new Date()) {
  const [quotaWindows, contents] = await prisma.$transaction([
    prisma.providerQuotaWindow.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.notificationContent.deleteMany({
      where: { expiresAt: { lt: now }, notifications: { none: {} }, fanouts: { none: {} } },
    }),
  ]);
  return { quotaWindows: quotaWindows.count, contents: contents.count };
}
