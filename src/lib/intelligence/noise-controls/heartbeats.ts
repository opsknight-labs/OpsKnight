import 'server-only';
import type { IncidentUrgency, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { addOperationalMetric, setOperationalGauge } from '@/lib/metrics/operational/registry';
import { getIntelligenceSettings } from '../settings/service';
import { purgePrePagingDecisions } from './decisions';
import { hashHeartbeatToken } from './manage';

type Client = Prisma.TransactionClient | typeof prisma;

/** Heartbeat incidents are ingested under this integration id, so trigger and resolve share one dedup scope. */
export const HEARTBEAT_INTEGRATION_ID = 'noise-controls:heartbeat';
const SWEEP_LIMIT = 500;

const SEVERITY_FOR: Record<IncidentUrgency, 'critical' | 'error' | 'warning'> = {
  HIGH: 'critical',
  MEDIUM: 'error',
  LOW: 'warning',
};

function describeDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export type HeartbeatPingOutcome = 'ok' | 'recovered' | 'unknown' | 'paused';

/**
 * A ping from the monitored job. Unknown tokens answer the same as paused monitors so the endpoint cannot
 * be used to enumerate monitors. A ping after a miss resolves the open heartbeat incident through the
 * normal event path.
 */
export async function recordHeartbeat(
  token: string,
  now: Date = new Date()
): Promise<HeartbeatPingOutcome> {
  const monitor = await prisma.heartbeatMonitor.findUnique({
    where: { tokenHash: hashHeartbeatToken(token) },
    select: {
      id: true,
      name: true,
      serviceId: true,
      enabled: true,
      state: true,
      lastIncidentId: true,
    },
  });
  if (!monitor) {
    addOperationalMetric('opsknight_heartbeat_pings_total', 1, { outcome: 'unknown' });
    return 'unknown';
  }
  if (!monitor.enabled) {
    addOperationalMetric('opsknight_heartbeat_pings_total', 1, { outcome: 'paused' });
    return 'paused';
  }
  await prisma.heartbeatMonitor.update({
    where: { id: monitor.id },
    data: { lastPingAt: now, state: 'HEALTHY', missingSince: null },
  });
  if (monitor.state === 'MISSING') {
    try {
      const { processEvent } = await import('@/lib/events');
      await processEvent(
        {
          event_action: 'resolve',
          dedup_key: `heartbeat:${monitor.id}`,
          payload: {
            summary: `Heartbeat "${monitor.name}" recovered`,
            source: 'heartbeat',
            severity: 'info',
          },
        },
        monitor.serviceId,
        HEARTBEAT_INTEGRATION_ID
      );
    } catch (error) {
      logger.warn('[Intelligence] Heartbeat recovery could not resolve its incident', {
        monitorId: monitor.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    addOperationalMetric('opsknight_heartbeat_pings_total', 1, { outcome: 'recovered' });
    return 'recovered';
  }
  addOperationalMetric('opsknight_heartbeat_pings_total', 1, { outcome: 'ok' });
  return 'ok';
}

export interface HeartbeatSweepResult {
  checked: number;
  late: number;
  missing: number;
  raised: number;
}

/**
 * Marks monitors LATE past their interval and MISSING past interval + grace; a newly missing monitor
 * raises an incident through `processEvent` (the normal ingestion path, with the normal paging). A
 * monitor that was never pinged is due from its creation, so a job that never started is noticed too.
 */
export async function sweepHeartbeatMonitors(
  now: Date = new Date(),
  client: Client = prisma
): Promise<HeartbeatSweepResult> {
  const monitors = await client.heartbeatMonitor.findMany({
    where: { enabled: true, state: { not: 'PAUSED' } },
    orderBy: { lastPingAt: 'asc' },
    take: SWEEP_LIMIT,
    select: {
      id: true,
      name: true,
      serviceId: true,
      intervalSeconds: true,
      graceSeconds: true,
      urgency: true,
      state: true,
      lastPingAt: true,
      createdAt: true,
    },
  });
  const result: HeartbeatSweepResult = { checked: monitors.length, late: 0, missing: 0, raised: 0 };
  for (const monitor of monitors) {
    const anchor = monitor.lastPingAt ?? monitor.createdAt;
    const dueAt = anchor.getTime() + monitor.intervalSeconds * 1000;
    const missingAt = dueAt + monitor.graceSeconds * 1000;
    if (now.getTime() >= missingAt) {
      result.missing += 1;
      if (monitor.state === 'MISSING') continue;
      await client.heartbeatMonitor.updateMany({
        where: { id: monitor.id, state: { not: 'MISSING' } },
        data: { state: 'MISSING', missingSince: now },
      });
      try {
        const { processEvent } = await import('@/lib/events');
        const outcome = await processEvent(
          {
            event_action: 'trigger',
            dedup_key: `heartbeat:${monitor.id}`,
            payload: {
              summary: `Heartbeat "${monitor.name}" missing: no ping for ${describeDuration(now.getTime() - anchor.getTime())}`,
              source: 'heartbeat',
              severity: SEVERITY_FOR[monitor.urgency],
              custom_details: {
                heartbeat_monitor: monitor.id,
                expected_interval_seconds: monitor.intervalSeconds,
                grace_seconds: monitor.graceSeconds,
                last_ping_at: monitor.lastPingAt?.toISOString() ?? null,
              },
            },
          },
          monitor.serviceId,
          HEARTBEAT_INTEGRATION_ID
        );
        if ('incident' in outcome && outcome.incident) {
          await client.heartbeatMonitor.updateMany({
            where: { id: monitor.id },
            data: { lastIncidentId: outcome.incident.id },
          });
          result.raised += 1;
        }
      } catch (error) {
        logger.warn(
          '[Intelligence] Heartbeat miss could not raise its incident; will retry next sweep',
          {
            monitorId: monitor.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // Let the next sweep try again rather than leaving a silent miss.
        await client.heartbeatMonitor.updateMany({
          where: { id: monitor.id },
          data: { state: 'LATE' },
        });
      }
    } else if (now.getTime() >= dueAt) {
      result.late += 1;
      if (monitor.state !== 'LATE')
        await client.heartbeatMonitor.updateMany({
          where: { id: monitor.id, state: { not: 'MISSING' } },
          data: { state: 'LATE' },
        });
    }
  }
  setOperationalGauge('opsknight_heartbeat_monitors_missing', result.missing);
  return result;
}

export interface PrePagingSweepResult {
  heartbeats: HeartbeatSweepResult;
  expiredRulesDisabled: number;
  decisionsPurged: number;
}

/**
 * The cron tick's bounded sweep for the noise controls: heartbeat misses, expired suppression rules and
 * decision retention. Each part is isolated so one failure never stops the others.
 */
export async function sweepPrePagingControls(
  now: Date = new Date()
): Promise<PrePagingSweepResult> {
  const result: PrePagingSweepResult = {
    heartbeats: { checked: 0, late: 0, missing: 0, raised: 0 },
    expiredRulesDisabled: 0,
    decisionsPurged: 0,
  };
  try {
    result.heartbeats = await sweepHeartbeatMonitors(now);
  } catch (error) {
    logger.warn('[Intelligence] Heartbeat sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    result.expiredRulesDisabled = (
      await prisma.suppressionRule.updateMany({
        where: { enabled: true, expiresAt: { lt: now } },
        data: { enabled: false },
      })
    ).count;
  } catch (error) {
    logger.warn('[Intelligence] Expired suppression rule sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    const settings = await getIntelligenceSettings();
    const cutoff = new Date(now.getTime() - settings.correlationRetentionDays * 86_400_000);
    result.decisionsPurged = await purgePrePagingDecisions(cutoff, 1_000);
  } catch (error) {
    logger.warn('[Intelligence] Pre-paging decision retention failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return result;
}
