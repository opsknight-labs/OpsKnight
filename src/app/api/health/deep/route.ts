import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { tokensMatch } from '@/lib/metrics/scrape';
import { getJobWorkerStatus } from '@/lib/job-worker';
import { getCronSchedulerStatus } from '@/lib/cron-scheduler';
import { jsonApiOk } from '@/lib/api-response';
import { getRealtimeControlPlaneStatus } from '@/lib/realtime-change-control-plane';
import { getDashboardAnalyticsHealth } from '@/lib/dashboard/dashboard-analytics-cache';
import { withMcpDatabase } from '@/lib/database-workload';
import { mcpSlotUsage } from '@/lib/mcp/core/budget';
import { mcpStreamUsage } from '@/lib/mcp/protocol/subscriptions';
import { mcpForceDisabled } from '@/lib/mcp/core/kill-switch';

const MCP_CHECK_TIMEOUT_MS = 1000;

/**
 * One round trip through the MCP database route (its own pool when MCP_DATABASE_URL is set), the
 * MCP switch and this process's work-slot usage. A broken or exhausted MCP pool shows here.
 */
async function mcpHealth() {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const policy = await Promise.race([
      withMcpDatabase(async () => {
        await prisma.$queryRaw`SELECT 1`;
        return prisma.mcpPolicy.findUnique({
          where: { id: 'default' },
          select: { enabled: true, maxInFlight: true },
        });
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('MCP health check timed out')),
          MCP_CHECK_TIMEOUT_MS
        );
      }),
    ]);
    return {
      latencyMs: Math.round(performance.now() - started),
      enabled: (policy?.enabled ?? false) && !mcpForceDisabled(),
      forceDisabled: mcpForceDisabled(),
      // Every limit here is per process; cluster capacity is each one times the web replicas.
      ...mcpSlotUsage(policy?.maxInFlight),
      ...mcpStreamUsage(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function authorized(request: Request): Promise<boolean> {
  const token = process.env.PROMETHEUS_SCRAPE_TOKEN;
  if (token && tokensMatch(request.headers.get('authorization'), token)) return true;
  const session = await getServerSession(await getAuthOptions());
  return session?.user?.role === 'ADMIN';
}

export async function GET(request: Request) {
  if (!(await authorized(request))) return new NextResponse('Unauthorized', { status: 401 });

  const now = Date.now();
  const [queue, notifications, rollup, mcp] = await Promise.allSettled([
    prisma.backgroundJob.aggregate({
      where: { status: 'PENDING' },
      _count: { id: true },
      _min: { scheduledAt: true },
    }),
    prisma.notification.aggregate({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      _count: { id: true },
      _min: { createdAt: true },
    }),
    prisma.incidentMetricRollup.findFirst({
      where: { granularity: 'daily' },
      orderBy: { date: 'desc' },
      select: { date: true, updatedAt: true },
    }),
    mcpHealth(),
  ]);

  const ageSeconds = (date: Date | null | undefined) =>
    date ? Math.max(0, (now - date.getTime()) / 1000) : null;
  return jsonApiOk(
    {
      status: [queue, notifications, rollup, mcp].every(result => result.status === 'fulfilled')
        ? 'healthy'
        : 'degraded',
      timestamp: new Date(now).toISOString(),
      worker: getJobWorkerStatus(),
      scheduler: await getCronSchedulerStatus(),
      realtime: getRealtimeControlPlaneStatus(),
      dashboardAnalytics: getDashboardAnalyticsHealth(),
      jobs:
        queue.status === 'fulfilled'
          ? {
              pending: queue.value._count.id,
              oldestPendingAgeSeconds: ageSeconds(queue.value._min.scheduledAt),
            }
          : { status: 'unavailable' },
      notifications:
        notifications.status === 'fulfilled'
          ? {
              pending: notifications.value._count.id,
              oldestPendingAgeSeconds: ageSeconds(notifications.value._min.createdAt),
            }
          : { status: 'unavailable' },
      rollups:
        rollup.status === 'fulfilled'
          ? {
              lastCompleteDay: rollup.value?.date ?? null,
              ageSeconds: ageSeconds(rollup.value?.updatedAt),
            }
          : { status: 'unavailable' },
      mcp: mcp.status === 'fulfilled' ? { status: 'ok', ...mcp.value } : { status: 'unavailable' },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
