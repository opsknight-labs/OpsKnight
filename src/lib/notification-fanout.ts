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

export async function bulkQueueHasCapacity(): Promise<boolean> {
  const { high } = await resolverWatermarks();
  const depth = await prisma.notification.count({
    where: {
      trafficClass: { in: ['PUBLIC_INCIDENT', 'BULK'] },
      status: { in: ['PENDING', 'FAILED'] },
    },
  });
  return depth < high;
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
