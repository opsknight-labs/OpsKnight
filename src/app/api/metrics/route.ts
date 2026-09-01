import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { withRequestContext } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import { activeIncidentStatuses } from '@/lib/incident-status';

type MetricsSnapshot = {
  jobStats: Array<{ status: string; count: number }> | null;
  incidentCount: number | null;
  activeUsers: number | null;
};

let metricsCache: { expiresAt: number; value: MetricsSnapshot } | null = null;
let metricsInflight: Promise<MetricsSnapshot> | null = null;

export function clearMetricsCache() {
  metricsCache = null;
  metricsInflight = null;
}

async function collectMetricsCached(): Promise<MetricsSnapshot> {
  if (metricsCache && metricsCache.expiresAt > Date.now()) return metricsCache.value;
  if (metricsInflight) return metricsInflight;
  metricsInflight = (async () => {
    const [jobs, incidents, users] = await Promise.allSettled([
      prisma.backgroundJob.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.incident.count({ where: { status: { in: activeIncidentStatuses() } } }),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
    ]);
    const value: MetricsSnapshot = {
      jobStats:
        jobs.status === 'fulfilled'
          ? jobs.value.map(row => ({ status: row.status, count: row._count.id }))
          : null,
      incidentCount: incidents.status === 'fulfilled' ? incidents.value : null,
      activeUsers: users.status === 'fulfilled' ? users.value : null,
    };
    metricsCache = { value, expiresAt: Date.now() + 10_000 };
    return value;
  })().finally(() => {
    metricsInflight = null;
  });
  return metricsInflight;
}

function tokensMatch(actual: string | null, expected: string) {
  if (!actual?.startsWith('Bearer ')) return false;
  const actualBuffer = Buffer.from(actual.slice(7));
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

async function getMetrics(req: Request) {
  // Allow Prometheus scraping via Bearer token OR a freshly resolved active admin session.
  const authHeader = req.headers.get('authorization');
  const prometheusToken = process.env.PROMETHEUS_SCRAPE_TOKEN;

  if (!(prometheusToken && tokensMatch(authHeader, prometheusToken))) {
    try {
      await assertAdmin();
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const snapshot = await collectMetricsCached();

  const lines: string[] = [
    '# HELP opsknight_build_info Build information',
    '# TYPE opsknight_build_info gauge',
    `opsknight_build_info{version="${escapeLabel(process.env.npm_package_version ?? 'unknown')}"} 1`,
    '',
    '# HELP opsknight_active_incidents Number of open or acknowledged incidents',
    '# TYPE opsknight_active_incidents gauge',
  ];

  if (snapshot.incidentCount !== null)
    lines.push(`opsknight_active_incidents ${snapshot.incidentCount}`);
  if (snapshot.activeUsers !== null) {
    lines.push(
      '',
      '# HELP opsknight_active_users Number of active users',
      '# TYPE opsknight_active_users gauge'
    );
    lines.push(`opsknight_active_users ${snapshot.activeUsers}`);
  }
  if (snapshot.jobStats) {
    lines.push(
      '',
      '# HELP opsknight_job_queue Job queue counts by status',
      '# TYPE opsknight_job_queue gauge'
    );
    for (const row of snapshot.jobStats) {
      lines.push(
        `opsknight_job_queue{status="${escapeLabel(row.status.toLowerCase())}"} ${row.count}`
      );
    }
  }

  const collectionErrors =
    Number(snapshot.incidentCount === null) +
    Number(snapshot.activeUsers === null) +
    Number(snapshot.jobStats === null);
  lines.push(
    '',
    '# HELP opsknight_metrics_collection_errors Number of collectors that failed in the latest snapshot',
    '# TYPE opsknight_metrics_collection_errors gauge',
    `opsknight_metrics_collection_errors ${collectionErrors}`
  );

  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  });
}

export const GET = withRequestContext(getMetrics, 'api.metrics');
