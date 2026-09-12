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
  const depth = await prisma.notification.count({
    where: {
      trafficClass: { in: ['PUBLIC_INCIDENT', 'BULK'] },
      status: { in: ['PENDING', 'FAILED'] },
    },
  });
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

export async function bulkQueueHasCapacity(): Promise<boolean> {
  const { low, high } = await resolverWatermarks();
  const depth = await prisma.notification.count({
    where: {
      trafficClass: { in: ['PUBLIC_INCIDENT', 'BULK'] },
      status: { in: ['PENDING', 'FAILED'] },
    },
  });
  const state = await getBulkBackpressureState();
  if (state === 'PAUSED') {
    if (depth < low) {
      await setBulkBackpressureState('NORMAL');
      return true;
    }
    return false;
  }
  if (depth >= high) {
    await setBulkBackpressureState('PAUSED');
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
