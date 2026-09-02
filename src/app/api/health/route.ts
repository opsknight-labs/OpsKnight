import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { getJobWorkerStatus } from '@/lib/job-worker';
import { getOpsKnightProcessRole, getRuntimeResponsibilities } from '@/lib/runtime-role';

import v8 from 'v8';

// Generate a unique ID when the server process starts
const SERVER_INSTANCE_ID = Date.now().toString();

/**
 * Health check endpoint
 * Returns the health status of the application and its dependencies
 *
 * GET /api/health
 */
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode') || 'liveness';
  const checks: Record<
    string,
    {
      status: 'healthy' | 'unhealthy' | 'disabled' | 'degraded';
      latency?: number;
      error?: string;
      expected?: boolean;
    }
  > = {};

  if (mode === 'readiness') {
    const responsibilities = getRuntimeResponsibilities(getOpsKnightProcessRole());
    // Check database connection with timeout
    try {
      const dbStartTime = Date.now();
      let timerId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error('Database connection timeout')), 5000);
      });

      try {
        await Promise.race([prisma.$queryRaw`SELECT 1`, timeoutPromise]);
      } finally {
        if (timerId) clearTimeout(timerId);
      }
      const dbLatency = Date.now() - dbStartTime;

      checks.database = {
        status: 'healthy',
        latency: dbLatency,
      };
    } catch (_) {
      checks.database = {
        status: 'unhealthy',
        error: 'Database connection failed',
      };
    }

    const schedulerExpected =
      responsibilities.startScheduler && process.env.ENABLE_INTERNAL_CRON !== 'false';
    if (!schedulerExpected) {
      checks.scheduler = { status: 'disabled', expected: false };
    } else
      try {
        const schedulerStartTime = Date.now();
        const maximumCadenceSeconds = Math.max(
          30,
          Number(process.env.SCHEDULER_HEALTH_MAX_INTERVAL_SECONDS ?? 120)
        );
        const [schedulerState] = await prisma.$queryRaw<
          Array<{ secondsSinceSuccess: number | null }>
        >`
        SELECT EXTRACT(EPOCH FROM (NOW() - "lastSuccessAt"))::double precision AS "secondsSinceSuccess"
        FROM "cron_scheduler_state"
        WHERE "id" = 'singleton'
        LIMIT 1
      `;
        const stale =
          !schedulerState ||
          schedulerState.secondsSinceSuccess === null ||
          schedulerState.secondsSinceSuccess > maximumCadenceSeconds * 5;
        checks.scheduler = {
          status: stale ? 'unhealthy' : 'healthy',
          latency: Date.now() - schedulerStartTime,
          ...(stale ? { error: 'Scheduler state is missing or stale' } : {}),
        };
      } catch (_) {
        checks.scheduler = { status: 'unhealthy', error: 'Scheduler state query failed' };
      }

    if (responsibilities.startJobWorker) {
      const worker = getJobWorkerStatus();
      const nowMs = Date.now();
      const idlePollMs = worker.config?.idlePollMs ?? 5_000;
      const startupGraceMs = Math.max(30_000, idlePollMs * 5);
      const staleAfterMs = Math.max(60_000, idlePollMs * 10);
      const withinStartupGrace =
        worker.startedAt !== null && nowMs - worker.startedAt.getTime() <= startupGraceMs;
      const secondsSinceSuccess = worker.lastSuccessAt
        ? Math.max(0, (nowMs - worker.lastSuccessAt.getTime()) / 1000)
        : null;
      const recentSuccess =
        (worker.lastSuccessAt !== null && nowMs - worker.lastSuccessAt.getTime() <= staleAfterMs) ||
        withinStartupGrace;
      const healthy = worker.running && recentSuccess;
      checks.worker = {
        status: healthy ? 'healthy' : 'degraded',
        latency: secondsSinceSuccess ?? undefined,
        ...(healthy
          ? {}
          : {
              error: worker.running
                ? 'Required local worker has no recent successful cycle'
                : 'Required local worker is not running',
            }),
      };
    }
  }

  // Check memory usage (evaluated against V8 max heap limit)
  try {
    const memUsage = process.memoryUsage();
    const heapStats = typeof v8.getHeapStatistics === 'function' ? v8.getHeapStatistics() : null;
    const heapUsedPercent = heapStats
      ? (heapStats.used_heap_size / heapStats.heap_size_limit) * 100
      : (memUsage.heapUsed / memUsage.heapTotal) * 100;

    checks.memory = {
      status: heapUsedPercent > 92 ? 'unhealthy' : 'healthy',
      latency: Math.round(memUsage.heapUsed / 1024 / 1024),
    };
  } catch (_) {
    checks.memory = {
      status: 'unhealthy',
      error: 'Memory check failed',
    };
  }

  const readinessChecks =
    mode === 'readiness'
      ? Object.entries(checks)
          .filter(([key]) => key !== 'memory')
          .map(([, value]) => value)
      : Object.values(checks);
  const allHealthy =
    readinessChecks.length === 0
      ? true
      : readinessChecks.every(check => check.status === 'healthy');
  const allReady = readinessChecks.every(
    check =>
      check.status === 'healthy' || check.status === 'disabled' || check.status === 'degraded'
  );

  // For HTTP traffic readiness, database connectivity is the hard requirement.
  // Auxiliary background worker, scheduler, or memory degradations report as 'degraded' (HTTP 200)
  // so the pod continues serving web traffic and avoids CrashLoopBackOff.
  const criticalFailure =
    mode === 'readiness'
      ? checks.database?.status === 'unhealthy'
      : readinessChecks.some(check => check.status === 'unhealthy');

  const anyDegraded = readinessChecks.some(check => check.status === 'degraded');
  const overallStatus = criticalFailure
    ? 'unhealthy'
    : anyDegraded
      ? 'degraded'
      : allReady || allHealthy
        ? 'healthy'
        : 'degraded';

  const response = {
    status: overallStatus,
    mode,
    timestamp: new Date().toISOString(),
    checks,
    uptime: Math.round(process.uptime()),
    version: APP_VERSION,
    environment: process.env.NODE_ENV || 'development',
    instanceId: SERVER_INSTANCE_ID,
  };

  const statusCode =
    mode === 'readiness'
      ? overallStatus === 'healthy'
        ? 200
        : overallStatus === 'degraded'
          ? 200
          : 503
      : 200;

  // Add cache control headers
  const headers = new Headers();
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');

  return NextResponse.json(response, { status: statusCode, headers });
}
