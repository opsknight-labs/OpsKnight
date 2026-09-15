import 'server-only';

import prisma from '@/lib/prisma';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

/**
 * Neutral reconciliation sweep.
 * Iterates READY rooms across all providers, delegates per-room health checks
 * to the provider adapter's `reconcile`, and aggregates centralized metrics.
 * The engine remains provider-agnostic — only the adapter knows Slack
 * `conversations.info` vs Graph `getChannelById`.
 */
export async function reconcileWarRoomHealth(limit = 40): Promise<{
  checked: number;
  healthy: number;
  degraded: number;
  byProvider: Record<string, { checked: number; healthy: number }>;
}> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { state: 'READY' },
    orderBy: { lastReconciledAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true, provider: true },
  });

  const byProvider: Record<string, { checked: number; healthy: number }> = {};
  let healthy = 0;

  for (const room of rooms) {
    if (!byProvider[room.provider]) byProvider[room.provider] = { checked: 0, healthy: 0 };
    byProvider[room.provider].checked++;

    try {
      const { reconcileWarRoom } = await import('./engine');
      await reconcileWarRoom(room.id);
      const fresh = await prisma.incidentWarRoom.findUnique({
        where: { id: room.id },
        select: { health: true },
      });
      if (fresh?.health === 'HEALTHY') {
        healthy++;
        byProvider[room.provider].healthy++;
      }
    } catch {
      // Retryable health probes keep lastReconciledAt stale so next sweep retries
      continue;
    }
  }

  addOperationalMetric('opsknight_war_room_reconciliation_total', 1, {
    provider: 'ALL',
    result: 'sweep',
  });

  return { checked: rooms.length, healthy, degraded: rooms.length - healthy, byProvider };
}

/**
 * Enqueue a single-room reconciliation job.
 * Used by the war-room detail view and AMBIGUOUS recovery.
 */
export async function requestWarRoomReconciliation(warRoomId: string): Promise<boolean> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    select: { id: true, state: true },
  });
  if (!room) return false;
  // Permit reconciliation for READY and AMBIGUOUS — READY verifies health,
  // AMBIGUOUS re-enters the marker/name reconciliation path via provision.
  if (!['READY', 'AMBIGUOUS'].includes(room.state)) return false;

  const { scheduleJob } = await import('@/lib/jobs/queue');
  await scheduleJob('WAR_ROOM_RECONCILE', new Date(), { warRoomId }, 3);
  addOperationalMetric('opsknight_war_room_reconciliation_total', 1, {
    provider: 'ALL',
    result: 'queued',
  });
  return true;
}
