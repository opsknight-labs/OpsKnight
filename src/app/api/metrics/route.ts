import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import { withRequestContext } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { OperationalMetricSnapshot } from '@/lib/metrics/operational/registry';

type MetricsSnapshot = {
  jobStats: Array<{ status: string; count: number }> | null;
  jobTypeStats: Array<{
    type: string;
    status: string;
    count: number;
    oldestPendingAgeSeconds: number | null;
  }> | null;
  incidentCount: number | null;
  activeUsers: number | null;
  notificationBacklog: { count: number; oldestAt: Date | null } | null;
  escalationBacklog: { count: number; oldestDueAt: Date | null } | null;
  rollupUpdatedAt: Date | null | undefined;
  integrationControlPlane: Array<{ kind: string; status: string; count: number }> | null;
  providerCooldowns: Array<{ provider: string; count: number }> | null;
  collectedAt: number;
};

let metricsCache: { expiresAt: number; value: MetricsSnapshot } | null = null;
let metricsInflight: Promise<MetricsSnapshot> | null = null;
let metricsCacheHits = 0;
let metricsCacheMisses = 0;
const DB_COLLECTOR_TIMEOUT_MS = 2_000;
const collectorInflight = new Map<string, Promise<unknown>>();

export async function collectWithTimeout<T>(
  name: string,
  timeoutMs: number,
  collect: () => Promise<T>
): Promise<T> {
  if (collectorInflight.has(name)) {
    throw new Error(`Metrics collector still running: ${name}`);
  }
  const operation = collect();
  collectorInflight.set(name, operation);
  void operation.finally(() => collectorInflight.delete(name)).catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Metrics collector timed out: ${name}`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function clearMetricsCache() {
  metricsCache = null;
  metricsInflight = null;
  metricsCacheHits = 0;
  metricsCacheMisses = 0;
}

async function collectMetricsCached(): Promise<MetricsSnapshot> {
  if (metricsCache && metricsCache.expiresAt > Date.now()) {
    metricsCacheHits += 1;
    return metricsCache.value;
  }
  if (metricsInflight) {
    metricsCacheHits += 1;
    return metricsInflight;
  }
  metricsCacheMisses += 1;
  metricsInflight = (async () => {
    const [
      jobs,
      jobTypes,
      incidents,
      users,
      notifications,
      escalations,
      rollup,
      controlPlane,
      cooldowns,
    ] = await Promise.allSettled([
      collectWithTimeout('jobs', DB_COLLECTOR_TIMEOUT_MS, () =>
        prisma.backgroundJob.groupBy({ by: ['status'], _count: { id: true } })
      ),
      collectWithTimeout(
        'job-types',
        DB_COLLECTOR_TIMEOUT_MS,
        () => prisma.$queryRaw<
          Array<{
            type: string;
            status: string;
            count: bigint;
            oldestPendingAgeSeconds: number | null;
          }>
        >`
        SELECT "type"::text, "status"::text, COUNT(*)::bigint AS count,
          CASE WHEN "status" = 'PENDING'
            THEN EXTRACT(EPOCH FROM (NOW() - MIN("scheduledAt")))::double precision
            ELSE NULL
          END AS "oldestPendingAgeSeconds"
        FROM "BackgroundJob"
        WHERE "status" IN ('PENDING', 'PROCESSING')
        GROUP BY "type", "status"
      `
      ),
      collectWithTimeout('incidents', DB_COLLECTOR_TIMEOUT_MS, () =>
        prisma.incident.count({ where: { status: { in: activeIncidentStatuses() } } })
      ),
      collectWithTimeout('users', DB_COLLECTOR_TIMEOUT_MS, () =>
        prisma.user.count({ where: { status: 'ACTIVE' } })
      ),
      collectWithTimeout('notifications', DB_COLLECTOR_TIMEOUT_MS, async () => {
        const value = await prisma.notification.aggregate({
          where: { status: { in: ['PENDING', 'FAILED'] } },
          _count: { id: true },
          _min: { createdAt: true },
        });
        return { count: value._count.id, oldestAt: value._min.createdAt };
      }),
      collectWithTimeout('escalations', DB_COLLECTOR_TIMEOUT_MS, async () => {
        const value = await prisma.incident.aggregate({
          where: { escalationStatus: 'ESCALATING', nextEscalationAt: { lt: new Date() } },
          _count: { id: true },
          _min: { nextEscalationAt: true },
        });
        return { count: value._count.id, oldestDueAt: value._min.nextEscalationAt };
      }),
      collectWithTimeout('rollup-freshness', DB_COLLECTOR_TIMEOUT_MS, () =>
        prisma.incidentMetricRollup.findFirst({
          where: { granularity: 'daily' },
          orderBy: { date: 'desc' },
          select: { updatedAt: true },
        })
      ),
      collectWithTimeout(
        'integration-control-plane',
        DB_COLLECTOR_TIMEOUT_MS,
        () => prisma.$queryRaw<Array<{ kind: string; status: string; count: bigint }>>`
          SELECT 'external' AS kind, "status"::text, COUNT(*)::bigint AS count FROM "ExternalOperation" GROUP BY "status"
          UNION ALL SELECT 'chatops', "status"::text, COUNT(*)::bigint FROM "ChatOpsIntent" GROUP BY "status"
          UNION ALL SELECT 'inbound', "status"::text, COUNT(*)::bigint FROM "InboundDelivery" GROUP BY "status"
        `
      ),
      collectWithTimeout(
        'provider-cooldowns',
        DB_COLLECTOR_TIMEOUT_MS,
        () => prisma.$queryRaw<Array<{ provider: string; count: bigint }>>`
          SELECT split_part("key", ':', 1) AS provider, COUNT(*)::bigint AS count
          FROM "ProviderAdmission" WHERE "blockedUntil" > NOW() GROUP BY 1
        `
      ),
    ]);
    const value: MetricsSnapshot = {
      jobStats:
        jobs.status === 'fulfilled'
          ? jobs.value.map(row => ({ status: row.status, count: row._count.id }))
          : null,
      jobTypeStats:
        jobTypes.status === 'fulfilled' && Array.isArray(jobTypes.value)
          ? jobTypes.value.map(row => ({
              ...row,
              count: Number(row.count),
            }))
          : null,
      incidentCount: incidents.status === 'fulfilled' ? incidents.value : null,
      activeUsers: users.status === 'fulfilled' ? users.value : null,
      notificationBacklog: notifications.status === 'fulfilled' ? notifications.value : null,
      escalationBacklog: escalations.status === 'fulfilled' ? escalations.value : null,
      rollupUpdatedAt: rollup.status === 'fulfilled' ? rollup.value?.updatedAt : undefined,
      integrationControlPlane:
        controlPlane.status === 'fulfilled'
          ? controlPlane.value.map(row => ({ ...row, count: Number(row.count) }))
          : null,
      providerCooldowns:
        cooldowns.status === 'fulfilled'
          ? cooldowns.value.map(row => ({ ...row, count: Number(row.count) }))
          : null,
      collectedAt: Date.now(),
    };
    const degraded =
      value.jobStats === null ||
      value.jobTypeStats === null ||
      value.incidentCount === null ||
      value.activeUsers === null ||
      value.notificationBacklog === null ||
      value.escalationBacklog === null ||
      value.rollupUpdatedAt === undefined ||
      value.integrationControlPlane === null ||
      value.providerCooldowns === null;
    // A JS timeout cannot cancel every Prisma operation. Back off degraded
    // collectors so repeated scrapes cannot create an unbounded query storm.
    metricsCache = { value, expiresAt: Date.now() + (degraded ? 60_000 : 10_000) };
    return value;
  })().finally(() => {
    metricsInflight = null;
  });
  return metricsInflight;
}

export function tokensMatch(actual: string | null, expected: string) {
  if (!actual?.startsWith('Bearer ')) return false;
  const actualBuffer = Buffer.from(actual.slice(7));
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function getMetrics(req: Request) {
  // Allow Prometheus scraping via Bearer token OR admin session
  const authHeader = req.headers.get('authorization');
  const prometheusToken = process.env.PROMETHEUS_SCRAPE_TOKEN;

  if (prometheusToken && tokensMatch(authHeader, prometheusToken)) {
    // Prometheus scraper — allow through
  } else {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user || session.user.role !== 'ADMIN') {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  // Collect metrics
  const snapshot = await collectMetricsCached();

  const metrics = new OperationalMetricSnapshot();
  metrics.set('opsknight_build_info', 1, {
    version: process.env.npm_package_version ?? 'unknown',
  });
  if (snapshot.incidentCount !== null)
    metrics.set('opsknight_active_incidents', snapshot.incidentCount);
  if (snapshot.activeUsers !== null) metrics.set('opsknight_active_users', snapshot.activeUsers);
  if (snapshot.jobStats) {
    for (const row of snapshot.jobStats) {
      metrics.set('opsknight_job_queue', row.count, { status: row.status.toLowerCase() });
    }
  }
  if (snapshot.jobTypeStats) {
    for (const row of snapshot.jobTypeStats) {
      const type = row.type.toLowerCase();
      if (row.status === 'PENDING') {
        metrics.set('opsknight_jobs_pending', row.count, { type });
        if (row.oldestPendingAgeSeconds !== null) {
          metrics.set('opsknight_jobs_oldest_pending_age_seconds', row.oldestPendingAgeSeconds, {
            type,
          });
        }
      } else if (row.status === 'PROCESSING') {
        metrics.set('opsknight_jobs_processing', row.count, { type });
      }
    }
  }
  const ageSeconds = (date: Date | null) =>
    date ? Math.max(0, (Date.now() - date.getTime()) / 1000) : 0;
  if (snapshot.notificationBacklog) {
    metrics.set('opsknight_notifications_undelivered', snapshot.notificationBacklog.count);
    metrics.set(
      'opsknight_notifications_oldest_undelivered_age_seconds',
      ageSeconds(snapshot.notificationBacklog.oldestAt)
    );
  }
  if (snapshot.escalationBacklog) {
    metrics.set('opsknight_escalations_overdue', snapshot.escalationBacklog.count);
    metrics.set(
      'opsknight_escalation_max_lag_seconds',
      ageSeconds(snapshot.escalationBacklog.oldestDueAt)
    );
  }
  if (snapshot.rollupUpdatedAt) {
    metrics.set('opsknight_rollup_freshness_age_seconds', ageSeconds(snapshot.rollupUpdatedAt));
  }
  for (const row of snapshot.integrationControlPlane ?? []) {
    const name =
      row.kind === 'external'
        ? 'opsknight_external_operations'
        : row.kind === 'chatops'
          ? 'opsknight_chatops_intents'
          : 'opsknight_inbound_deliveries';
    metrics.set(name, row.count, { status: row.status.toLowerCase() });
  }
  for (const row of snapshot.providerCooldowns ?? []) {
    metrics.set('opsknight_provider_cooldown', row.count > 0 ? 1 : 0, { provider: row.provider });
  }

  const collectionErrors =
    Number(snapshot.incidentCount === null) +
    Number(snapshot.activeUsers === null) +
    Number(snapshot.jobStats === null) +
    Number(snapshot.jobTypeStats === null) +
    Number(snapshot.notificationBacklog === null) +
    Number(snapshot.escalationBacklog === null) +
    Number(snapshot.rollupUpdatedAt === undefined) +
    Number(snapshot.integrationControlPlane === null) +
    Number(snapshot.providerCooldowns === null);
  metrics.set('opsknight_metrics_collection_errors', collectionErrors);
  metrics.set('opsknight_metrics_cache_hits_total', metricsCacheHits);
  metrics.set('opsknight_metrics_cache_misses_total', metricsCacheMisses);
  metrics.set('opsknight_metrics_cache_age_seconds', (Date.now() - snapshot.collectedAt) / 1000);

  return new Response(metrics.render(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  });
}

export const GET = withRequestContext(getMetrics, 'api.metrics');
