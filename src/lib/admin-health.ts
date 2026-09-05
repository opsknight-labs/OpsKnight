import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import prisma from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { getMetricsByIntegration, getMetricsSummary } from '@/lib/integrations/metrics';

export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type HealthCategory = 'database' | 'workers' | 'alerting' | 'security' | 'platform';

export type CheckTelemetry = {
  latencyMs?: number;
  latencyThresholdMs?: number;
  poolUtilization?: {
    used: number;
    max: number;
    percent: number;
    active: number;
    sizeFormatted: string;
    longTx: number;
  };
  queueDistribution?: {
    pending: number;
    processing: number;
    failed: number;
    overdue: number;
    stale: number;
  };
  slaMetrics?: {
    p95Ms: number | null;
    p50Ms: number | null;
    avgMs: number | null;
    sampleCount: number;
  };
  rawPayload?: Record<string, unknown>;
};

export type AdminHealthCheck = {
  id: string;
  label: string;
  category: HealthCategory;
  status: HealthLevel;
  summary: string;
  details: string[];
  action?: { label: string; href: string };
  commandSnippet?: {
    command: string;
    description?: string;
    steps?: string[];
  };
  telemetry?: CheckTelemetry;
};

export type HealthHistorySample = {
  timestamp: string;
  hourLabel: string;
  status: HealthLevel;
  scorePercent: number;
  reason?: string;
  issues?: string[];
};

export type AdminHealthReport = {
  generatedAt: string;
  overall: HealthLevel;
  checks: AdminHealthCheck[];
  history?: HealthHistorySample[];
};

type MigrationRow = {
  migration_name: string;
  started_at: Date;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

type DatabaseCapacityRow = {
  databaseName: string;
  sizeBytes: string;
  maxConnections: number;
  usedConnections: number;
  activeConnections: number;
  longTransactions: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function ageLabel(date: Date | null): string {
  if (!date) return 'never';
  const ageMs = Math.max(0, Date.now() - date.getTime());
  if (ageMs < MINUTE) return 'less than a minute ago';
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} minutes ago`;
  if (ageMs < 24 * HOUR) return `${Math.floor(ageMs / HOUR)} hours ago`;
  return `${Math.floor(ageMs / (24 * HOUR))} days ago`;
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function compareVersions(current: string, latest: string): number {
  const parts = (version: string) =>
    version
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map(value => Number.parseInt(value, 10) || 0);
  const left = parts(current);
  const right = parts(latest);
  const maxLen = Math.max(left.length, right.length);
  for (let index = 0; index < maxLen; index += 1) {
    const lVal = left.at(index) ?? 0;
    const rVal = right.at(index) ?? 0;
    const difference = lVal - rVal;
    if (difference !== 0) return difference;
  }
  return 0;
}

function byteLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

async function latestRelease(): Promise<string | null> {
  try {
    const response = await fetch(
      'https://api.github.com/repos/opsknight-labs/OpsKnight/releases/latest',
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpsKnight-Health-Center' },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: string };
    return body.tag_name || null;
  } catch {
    return null;
  }
}

function overallStatus(checks: AdminHealthCheck[]): HealthLevel {
  if (checks.some(c => c.status === 'unhealthy')) return 'unhealthy';
  if (checks.some(c => c.status === 'degraded')) return 'degraded';
  if (checks.some(c => c.status === 'healthy')) return 'healthy';
  return 'unknown';
}

async function generate24HourHistory(
  checks: AdminHealthCheck[],
  overall: HealthLevel,
  now: Date
): Promise<HealthHistorySample[]> {
  const since = new Date(now.getTime() - 24 * HOUR);

  let incidents: Array<{
    id: string;
    title: string;
    priority: string | null;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }> = [];

  let failedJobs: Array<{
    id: string;
    createdAt: Date;
  }> = [];

  let failedDeliveries: Array<{
    id: string;
    createdAt: Date;
  }> = [];

  let failedNotifications: Array<{
    id: string;
    startedAt: Date;
  }> = [];

  try {
    incidents = await prisma.incident.findMany({
      where: {
        OR: [
          { createdAt: { gte: since } },
          { resolvedAt: { gte: since } },
          { status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } },
        ],
      },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
    });
  } catch {
    // Graceful fallback if database query is restricted
  }

  try {
    failedJobs = await prisma.backgroundJob.findMany({
      where: {
        createdAt: { gte: since },
        status: 'FAILED',
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
  } catch {
    // Graceful fallback
  }

  try {
    failedDeliveries = await prisma.inboundDelivery.findMany({
      where: {
        createdAt: { gte: since },
        status: 'FAILED',
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
  } catch {
    // Graceful fallback
  }

  try {
    failedNotifications = await prisma.notificationDeliveryAttempt.findMany({
      where: {
        startedAt: { gte: since },
        outcome: 'FAILED',
      },
      select: {
        id: true,
        startedAt: true,
      },
    });
  } catch {
    // Graceful fallback
  }

  const degradedChecks = checks.filter(c => c.status === 'degraded');
  const unhealthyChecks = checks.filter(c => c.status === 'unhealthy');

  // Pick top diagnostic summary if system has persistent issues
  const diagnosticSummary =
    unhealthyChecks.length > 0
      ? unhealthyChecks[0].summary
      : degradedChecks.length > 0
        ? degradedChecks[0].summary
        : undefined;

  const samples: HealthHistorySample[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * HOUR);
    const windowStart = new Date(d.getTime() - HOUR);
    const windowEnd = d;
    const hour = d.getHours();
    const hourLabel = `${hour.toString().padStart(2, '0')}:00`;

    // 1. Incidents active in this hourly bucket
    const activeIncidents = incidents.filter(inc => {
      const incStart = inc.createdAt.getTime();
      const incEnd = inc.resolvedAt ? inc.resolvedAt.getTime() : now.getTime();
      return incStart <= windowEnd.getTime() && incEnd >= windowStart.getTime();
    });

    // 2. Failed jobs in this hourly bucket
    const hourlyFailedJobs = failedJobs.filter(
      j =>
        j.createdAt.getTime() >= windowStart.getTime() &&
        j.createdAt.getTime() < windowEnd.getTime()
    );

    // 3. Failed webhook deliveries in this hourly bucket
    const hourlyFailedDeliveries = failedDeliveries.filter(
      del =>
        del.createdAt.getTime() >= windowStart.getTime() &&
        del.createdAt.getTime() < windowEnd.getTime()
    );

    // 4. Failed notification attempts in this hourly bucket
    const hourlyFailedNotifications = failedNotifications.filter(
      notif =>
        notif.startedAt.getTime() >= windowStart.getTime() &&
        notif.startedAt.getTime() < windowEnd.getTime()
    );

    let status: HealthLevel = 'healthy';
    let scorePercent = 100;
    let reason = 'All systems operating normally';

    const criticalInc = activeIncidents.find(inc => inc.priority === 'P1' || inc.priority === 'P2');
    const warningInc = activeIncidents.find(inc => inc.priority === 'P3' || inc.priority === 'P4');

    if (criticalInc) {
      status = 'unhealthy';
      scorePercent = 40;
      reason = `Critical incident (${criticalInc.priority || 'P1'}): ${criticalInc.title}`;
    } else if (warningInc) {
      status = 'degraded';
      scorePercent = 75;
      reason = `Active incident (${warningInc.priority || 'P3'}): ${warningInc.title}`;
    } else if (hourlyFailedJobs.length > 0) {
      status = 'degraded';
      scorePercent = 80;
      reason = `${hourlyFailedJobs.length} background job failure(s)`;
    } else if (hourlyFailedDeliveries.length > 0 || hourlyFailedNotifications.length > 0) {
      status = 'degraded';
      scorePercent = 85;
      reason = `${hourlyFailedDeliveries.length + hourlyFailedNotifications.length} delivery error(s)`;
    } else if (i === 0) {
      // Current live hour reflects active diagnostic check health
      status = overall;
      scorePercent = overall === 'healthy' ? 100 : overall === 'degraded' ? 85 : 40;
      reason =
        overall === 'healthy'
          ? 'All diagnostic signals passing'
          : diagnosticSummary ||
            (overall === 'degraded'
              ? 'Sub-optimal telemetry or retries'
              : 'Critical diagnostic error');
    } else if (overall === 'unhealthy' && unhealthyChecks.length > 0) {
      // If critical persistent check is failing, prior hours reflect this baseline
      status = 'unhealthy';
      scorePercent = 45;
      reason = diagnosticSummary || 'Critical diagnostic error';
    } else if (overall === 'degraded' && degradedChecks.length > 0) {
      // If persistent check is degraded (e.g. SLA p95 latency over 24h, unconfigured key)
      status = 'degraded';
      scorePercent = 85;
      reason = diagnosticSummary || 'Sub-optimal telemetry or retries';
    }

    samples.push({
      timestamp: d.toISOString(),
      hourLabel,
      status,
      scorePercent,
      reason,
    });
  }

  return samples;
}

export async function collectAdminHealth(): Promise<AdminHealthReport> {
  const now = new Date();
  const checks: AdminHealthCheck[] = [];

  let databaseAvailable = false;
  try {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - startedAt;
    databaseAvailable = true;
    checks.push({
      id: 'database',
      label: 'PostgreSQL Database',
      category: 'database',
      status: latency > 1000 ? 'degraded' : 'healthy',
      summary: `PostgreSQL responded in ${latency} ms.`,
      details: [
        `Connection latency: ${latency} ms`,
        latency > 1000
          ? 'Latency exceeds the 1-second health threshold.'
          : 'Connection check passed.',
      ],
      telemetry: {
        latencyMs: latency,
        latencyThresholdMs: 1000,
        rawPayload: {
          latencyMs: latency,
          thresholdMs: 1000,
          driver: 'Prisma Client PostgreSQL',
          pingQuery: 'SELECT 1',
        },
      },
      action: {
        label: 'Monitoring guide',
        href: 'https://opsknight.com/docs/v1.3/operations/monitoring',
      },
    });
  } catch (error) {
    checks.push({
      id: 'database',
      label: 'PostgreSQL Database',
      category: 'database',
      status: 'unhealthy',
      summary: 'PostgreSQL is unavailable to this application instance.',
      details: [
        'Check DATABASE_URL, network policy, credentials, TLS, capacity, and PostgreSQL logs.',
        `Error: ${error instanceof Error ? error.message : 'Unknown connection error'}`,
      ],
      telemetry: {
        rawPayload: {
          error: error instanceof Error ? error.message : 'Unknown connection error',
        },
      },
    });
  }

  if (databaseAvailable) {
    try {
      const [capacity] = await prisma.$queryRaw<DatabaseCapacityRow[]>`
        SELECT
          current_database() AS "databaseName",
          pg_database_size(current_database())::bigint::text AS "sizeBytes",
          current_setting('max_connections')::int AS "maxConnections",
          (SELECT count(*)::int FROM pg_stat_activity)
            AS "usedConnections",
          (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'active')
            AS "activeConnections",
          (SELECT count(*)::int FROM pg_stat_activity
            WHERE datname = current_database()
              AND xact_start IS NOT NULL
              AND xact_start < NOW() - INTERVAL '5 minutes')
            AS "longTransactions"
      `;
      const sizeBytesNum = capacity ? Number(capacity.sizeBytes) : 0;
      const sizeFormatted = capacity ? byteLabel(sizeBytesNum) : 'Unknown';
      const utilization = capacity
        ? Math.round((capacity.usedConnections / Math.max(1, capacity.maxConnections)) * 100)
        : 0;
      checks.push({
        id: 'database-capacity',
        label: 'Database capacity',
        category: 'database',
        status: !capacity
          ? 'unknown'
          : utilization >= 95 || capacity.longTransactions > 0
            ? 'unhealthy'
            : utilization >= 80
              ? 'degraded'
              : 'healthy',
        summary: capacity
          ? `${capacity.usedConnections} of ${capacity.maxConnections} connections in use (${utilization}%).`
          : 'Database capacity could not be measured.',
        details: capacity
          ? [
              `Active connections: ${capacity.activeConnections}`,
              `Transactions open longer than 5 minutes: ${capacity.longTransactions}`,
              `Database size: ${sizeFormatted}`,
              'Host CPU, memory, storage capacity, replicas, and pool wait require external telemetry.',
            ]
          : ['Check PostgreSQL statistics permissions.'],
        telemetry: capacity
          ? {
              poolUtilization: {
                used: capacity.usedConnections,
                max: capacity.maxConnections,
                percent: utilization,
                active: capacity.activeConnections,
                sizeFormatted,
                longTx: capacity.longTransactions,
              },
              rawPayload: {
                databaseName: capacity.databaseName,
                sizeBytes: capacity.sizeBytes,
                sizeFormatted,
                maxConnections: capacity.maxConnections,
                usedConnections: capacity.usedConnections,
                activeConnections: capacity.activeConnections,
                longTransactions: capacity.longTransactions,
                utilizationPercent: utilization,
              },
            }
          : undefined,
        action: {
          label: 'Capacity guide',
          href: 'https://opsknight.com/docs/v1.3/core-concepts/scalability',
        },
      });
    } catch {
      checks.push({
        id: 'database-capacity',
        label: 'Database capacity',
        category: 'database',
        status: 'unknown',
        summary: 'Database capacity statistics could not be read.',
        details: [
          'The application remains usable; inspect PostgreSQL and platform telemetry directly.',
        ],
      });
    }

    try {
      const rows = await prisma.$queryRaw<MigrationRow[]>`
        SELECT migration_name, started_at, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at DESC
      `;
      const failed = rows.filter(row => !row.finished_at && !row.rolled_back_at);
      const applied = new Set(rows.filter(row => row.finished_at).map(row => row.migration_name));
      const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations');
      const packaged = fs.existsSync(migrationRoot)
        ? fs
            .readdirSync(migrationRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
        : [];
      const pending = packaged.filter(name => !applied.has(name));
      const lastApplied = rows.find(row => row.finished_at)?.finished_at || null;
      checks.push({
        id: 'migrations',
        label: 'Database migrations',
        category: 'database',
        status: failed.length > 0 ? 'unhealthy' : pending.length > 0 ? 'degraded' : 'healthy',
        summary:
          failed.length > 0
            ? `${failed.length} failed migration record(s).`
            : pending.length > 0
              ? `${pending.length} packaged migration(s) are not applied.`
              : 'Packaged migrations match the database history.',
        details: [
          `Applied records: ${applied.size}`,
          `Last applied: ${lastApplied ? ageLabel(lastApplied) : 'none recorded'}`,
          ...(failed.length
            ? [
                `Failed: ${failed
                  .slice(0, 3)
                  .map(row => row.migration_name)
                  .join(', ')}`,
              ]
            : []),
          ...(pending.length
            ? [
                `Pending: ${pending
                  .slice(0, 3)
                  .join(', ')}${pending.length > 3 ? ` (+${pending.length - 3} more)` : ''}`,
              ]
            : []),
        ],
        commandSnippet:
          pending.length > 0 || failed.length > 0
            ? {
                command: 'npx prisma migrate deploy',
                description: 'Deploy packaged Prisma migrations to PostgreSQL',
                steps: [
                  'Take a full database snapshot or backup before migrating.',
                  'Run "npx prisma migrate deploy" in your terminal or container.',
                  'Run "npx prisma migrate status" to confirm all migrations applied successfully.',
                ],
              }
            : undefined,
        telemetry: {
          rawPayload: {
            appliedCount: applied.size,
            packagedCount: packaged.length,
            pendingCount: pending.length,
            failedCount: failed.length,
            pendingNames: pending,
            lastApplied: lastApplied?.toISOString() || null,
          },
        },
        action: {
          label: 'Migration runbook',
          href: 'https://opsknight.com/docs/v1.3/deployment/database-migrations',
        },
      });
    } catch {
      checks.push({
        id: 'migrations',
        label: 'Database migrations',
        category: 'database',
        status: 'unknown',
        summary: 'Migration history could not be inspected.',
        details: [
          'Confirm that the Prisma migration table exists and the application role can read it.',
        ],
      });
    }

    try {
      const schedulerEnabled = process.env.ENABLE_INTERNAL_CRON !== 'false';
      const state = await prisma.cronSchedulerState.findUnique({ where: { id: 'singleton' } });
      const age = state?.lastSuccessAt ? now.getTime() - state.lastSuccessAt.getTime() : null;
      const stale = schedulerEnabled && (age === null || age > 10 * MINUTE);
      checks.push({
        id: 'scheduler',
        label: 'Scheduler and workers',
        category: 'workers',
        status: !schedulerEnabled ? 'unknown' : state?.lastError || stale ? 'unhealthy' : 'healthy',
        summary: !schedulerEnabled
          ? 'Internal scheduler is disabled; an external worker must own scheduled work.'
          : state?.lastError
            ? 'The scheduler recorded an error.'
            : stale
              ? 'No recent successful scheduler heartbeat.'
              : `Last successful cycle ${ageLabel(state?.lastSuccessAt || null)}.`,
        details: [
          `Last run: ${ageLabel(state?.lastRunAt || null)}`,
          `Next run: ${state?.nextRunAt?.toISOString() || 'not scheduled'}`,
          `Lock holder: ${state?.lockedBy || 'none'}`,
          ...(state?.lastError
            ? ['A last-error marker is present; review restricted server logs for details.']
            : []),
        ],
        telemetry: {
          rawPayload: {
            schedulerEnabled,
            lockedBy: state?.lockedBy || null,
            lastRunAt: state?.lastRunAt?.toISOString() || null,
            lastSuccessAt: state?.lastSuccessAt?.toISOString() || null,
            nextRunAt: state?.nextRunAt?.toISOString() || null,
            lastError: state?.lastError || null,
          },
        },
        action: {
          label: 'Maintenance guide',
          href: 'https://opsknight.com/docs/v1.3/deployment/maintenance',
        },
      });
    } catch {
      checks.push({
        id: 'scheduler',
        label: 'Scheduler and workers',
        category: 'workers',
        status: 'unknown',
        summary: 'Scheduler state could not be read.',
        details: ['Check migration state and scheduler logs.'],
      });
    }

    try {
      const since24h = new Date(now.getTime() - 24 * HOUR);
      const [pending, processing, failed, overdue, stale] = await Promise.all([
        prisma.backgroundJob.count({ where: { status: 'PENDING' } }),
        prisma.backgroundJob.count({ where: { status: 'PROCESSING' } }),
        prisma.backgroundJob.count({
          where: { status: 'FAILED', updatedAt: { gte: since24h } },
        }),
        prisma.backgroundJob.count({ where: { status: 'PENDING', scheduledAt: { lt: now } } }),
        prisma.backgroundJob.count({
          where: { status: 'PROCESSING', startedAt: { lt: new Date(now.getTime() - 10 * MINUTE) } },
        }),
      ]);
      checks.push({
        id: 'jobs',
        label: 'Background jobs',
        category: 'workers',
        status: stale > 0 || failed > 0 ? 'unhealthy' : overdue > 0 ? 'degraded' : 'healthy',
        summary: `${pending} pending, ${processing} processing, ${failed} failed in 24 hours.`,
        details: [`Overdue pending: ${overdue}`, `Processing longer than 10 minutes: ${stale}`],
        telemetry: {
          queueDistribution: {
            pending,
            processing,
            failed,
            overdue,
            stale,
          },
          rawPayload: {
            pendingJobs: pending,
            processingJobs: processing,
            failedJobs: failed,
            overduePending: overdue,
            staleProcessing: stale,
          },
        },
      });
    } catch {
      checks.push({
        id: 'jobs',
        label: 'Background jobs',
        category: 'workers',
        status: 'unknown',
        summary: 'Background-job state could not be read.',
        details: ['Check database migration and scheduler health.'],
      });
    }

    try {
      const since = new Date(now.getTime() - 24 * HOUR);
      const logs = await prisma.$queryRaw<Array<{ durationMs: number; incidentCount: number }>>`
        SELECT "durationMs", "incidentCount"
        FROM sla_performance_logs
        WHERE timestamp >= ${since}
        ORDER BY timestamp DESC
      `;
      const durations = logs.map(log => log.durationMs).sort((left, right) => left - right);
      const percentile = (fraction: number) =>
        durations.length > 0
          ? durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))]
          : null;
      const average =
        durations.length > 0
          ? durations.reduce((total, duration) => total + duration, 0) / durations.length
          : null;
      const p50 = percentile(0.5);
      const p95 = percentile(0.95);
      const slow = durations.filter(duration => duration > 10_000).length;
      const averageIncidents =
        logs.length > 0
          ? logs.reduce((total, log) => total + log.incidentCount, 0) / logs.length
          : null;

      checks.push({
        id: 'sla-performance',
        label: 'SLA query performance',
        category: 'workers',
        status:
          logs.length === 0
            ? 'unknown'
            : slow > 0 || (p95 !== null && p95 > 10_000)
              ? 'degraded'
              : 'healthy',
        summary:
          logs.length === 0
            ? 'No recent SLA query timing data.'
            : `${logs.length} queries in 24 hours; p95 ${p95 ?? 0} ms.`,
        details:
          logs.length === 0
            ? ['SLA performance metrics require recorded calculation events.']
            : [
                `p50: ${p50 ?? 0} ms, average: ${average ? Math.round(average) : 0} ms`,
                `Queries exceeding 10s: ${slow}`,
                `Average incidents scanned per cycle: ${averageIncidents ? Math.round(averageIncidents) : 0}`,
              ],
        telemetry: {
          slaMetrics: {
            p95Ms: p95,
            p50Ms: p50,
            avgMs: average ? Math.round(average) : null,
            sampleCount: logs.length,
          },
          rawPayload: {
            sampleCount: logs.length,
            p95Ms: p95,
            p50Ms: p50,
            averageMs: average,
            slowQueriesCount: slow,
            averageIncidentsScanned: averageIncidents,
          },
        },
        action: {
          label: 'SLA guide',
          href: 'https://opsknight.com/docs/v1.3/core-concepts/sla-management',
        },
      });
    } catch {
      checks.push({
        id: 'sla-performance',
        label: 'SLA query performance',
        category: 'workers',
        status: 'unknown',
        summary: 'SLA performance data could not be queried.',
        details: ['Review database migration status and query logs.'],
      });
    }

    try {
      const overdue = await prisma.incident.count({
        where: {
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
          nextEscalationAt: { lt: now },
        },
      });
      const recentEvents = await prisma.incidentEvent.count({
        where: {
          createdAt: { gte: new Date(now.getTime() - 24 * HOUR) },
        },
      });
      checks.push({
        id: 'escalations',
        label: 'Escalation backlog',
        category: 'workers',
        status: overdue > 0 ? 'degraded' : 'healthy',
        summary:
          overdue > 0
            ? `${overdue} escalation step(s) are overdue.`
            : 'No escalation steps are overdue.',
        details: [
          `Overdue next-escalation timers: ${overdue}`,
          `Incident events in 24 hours: ${recentEvents}`,
        ],
        telemetry: {
          rawPayload: {
            overdueEscalations: overdue,
            recentEvents24h: recentEvents,
          },
        },
        action: { label: 'Incident queue', href: '/incidents' },
      });
    } catch {
      checks.push({
        id: 'escalations',
        label: 'Escalation backlog',
        category: 'workers',
        status: 'unknown',
        summary: 'Escalation state could not be read.',
        details: ['Review incident table health and database migrations.'],
      });
    }

    try {
      const services = await prisma.service.findMany({
        select: {
          name: true,
          escalationPolicyId: true,
          policy: { select: { steps: { select: { id: true }, take: 1 } } },
        },
        orderBy: { name: 'asc' },
      });
      const withoutPolicy = services.filter(service => !service.escalationPolicyId);
      const withoutSteps = services.filter(
        service => service.escalationPolicyId && service.policy?.steps.length === 0
      );
      const gaps = withoutPolicy.length + withoutSteps.length;
      checks.push({
        id: 'paging-configuration',
        label: 'Paging configuration coverage',
        category: 'alerting',
        status: services.length === 0 ? 'unknown' : gaps > 0 ? 'degraded' : 'healthy',
        summary:
          services.length === 0
            ? 'No services exist yet.'
            : gaps === 0
              ? `All ${services.length} services have an escalation policy with at least one step.`
              : `${gaps} of ${services.length} services cannot start policy-based paging.`,
        details: [
          `Without an escalation policy: ${withoutPolicy.map(service => service.name).join(', ') || 'none'}`,
          `Policy has no steps: ${withoutSteps.map(service => service.name).join(', ') || 'none'}`,
        ],
        telemetry: {
          rawPayload: {
            totalServices: services.length,
            withoutPolicyCount: withoutPolicy.length,
            withoutStepsCount: withoutSteps.length,
            uncoveredTotal: gaps,
          },
        },
        action: { label: 'Services', href: '/services' },
      });
    } catch {
      checks.push({
        id: 'paging-configuration',
        label: 'Paging configuration coverage',
        category: 'alerting',
        status: 'unknown',
        summary: 'Service paging coverage could not be calculated.',
        details: ['Review service escalation policies directly.'],
      });
    }

    try {
      const since = new Date(now.getTime() - 24 * HOUR);
      const [providers, failed, pending] = await Promise.all([
        prisma.notificationProvider.findMany({
          select: { provider: true, enabled: true, config: true, updatedAt: true },
          orderBy: { provider: 'asc' },
        }),
        prisma.notification.count({ where: { status: 'FAILED', createdAt: { gte: since } } }),
        prisma.notification.count({
          where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - 5 * MINUTE) } },
        }),
      ]);
      const enabled = providers.filter(provider => provider.enabled);
      const incomplete = enabled.filter(provider => {
        const config = provider.config as Record<string, unknown> | null;
        return !config || Object.keys(config).length === 0;
      });
      checks.push({
        id: 'notifications',
        label: 'Notification providers',
        category: 'alerting',
        status:
          incomplete.length > 0 || pending > 0 ? 'unhealthy' : failed > 0 ? 'degraded' : 'healthy',
        summary: `${enabled.length} enabled provider(s); ${failed} failed delivery record(s) in 24 hours.`,
        details: [
          `Pending longer than 5 minutes: ${pending}`,
          `Enabled without configuration: ${incomplete.map(item => item.provider).join(', ') || 'none'}`,
        ],
        telemetry: {
          rawPayload: {
            enabledProvidersCount: enabled.length,
            failedDeliveries24h: failed,
            pendingStaleDeliveries: pending,
            incompleteProviders: incomplete.map(item => item.provider),
          },
        },
        action: { label: 'Notification history', href: '/settings/notifications/history' },
      });
    } catch {
      checks.push({
        id: 'notifications',
        label: 'Notification providers',
        category: 'alerting',
        status: 'unknown',
        summary: 'Notification health could not be measured.',
        details: ['Open Notification History and provider settings.'],
      });
    }

    try {
      const enabledIntegrations = await prisma.integration.findMany({
        where: { enabled: true },
        select: { id: true, name: true, type: true },
      });
      const metrics = getMetricsSummary();
      const failingIntegrations = enabledIntegrations.filter(integration => {
        const current = getMetricsByIntegration(integration.id);
        return current.totalErrors > 0 && current.lastError;
      });
      checks.push({
        id: 'integrations',
        label: 'Inbound integrations',
        category: 'alerting',
        status: metrics.healthStatus,
        summary: `${enabledIntegrations.length} enabled integration(s); ${metrics.errorRate}% in-process error rate.`,
        details: [
          `Integrations with recorded errors: ${failingIntegrations.map(item => item.name).join(', ') || 'none'}`,
          'Metrics are process-local and reset on restart; durable logs remain authoritative.',
        ],
        telemetry: {
          rawPayload: {
            enabledIntegrationsCount: enabledIntegrations.length,
            errorRatePercent: metrics.errorRate,
            failingIntegrations: failingIntegrations.map(i => ({ id: i.id, name: i.name })),
          },
        },
        action: { label: 'Inbound services', href: '/services' },
      });
    } catch {
      checks.push({
        id: 'integrations',
        label: 'Inbound integrations',
        category: 'alerting',
        status: 'unknown',
        summary: 'Integration health could not be measured.',
        details: ['Review integration test results and system logs.'],
      });
    }

    try {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { appUrl: true },
      });
      const values = [settings?.appUrl, process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL];
      const origins = values
        .map(normalizeOrigin)
        .filter((value): value is string => Boolean(value));
      const consistent = origins.length >= 2 && new Set(origins).size === 1;
      const productionHttps =
        process.env.NODE_ENV !== 'production' ||
        origins.every(value => value.startsWith('https://'));
      checks.push({
        id: 'public-url',
        label: 'Public URL',
        category: 'security',
        status:
          origins.length === 0 || !productionHttps
            ? 'unhealthy'
            : consistent
              ? 'healthy'
              : 'degraded',
        summary: consistent
          ? `Canonical origin: ${origins[0]}`
          : 'Configured public origins do not fully agree.',
        details: [
          `Database setting: ${normalizeOrigin(settings?.appUrl) || 'unset'}`,
          `NEXT_PUBLIC_APP_URL: ${normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) || 'unset'}`,
          `NEXTAUTH_URL: ${normalizeOrigin(process.env.NEXTAUTH_URL) || 'unset'}`,
        ],
        telemetry: {
          rawPayload: {
            dbAppUrl: normalizeOrigin(settings?.appUrl),
            nextPublicAppUrl: normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
            nextAuthUrl: normalizeOrigin(process.env.NEXTAUTH_URL),
            isConsistent: consistent,
            isProductionHttps: productionHttps,
          },
        },
        action: { label: 'System settings', href: '/settings/system' },
      });
    } catch {
      checks.push({
        id: 'public-url',
        label: 'Public URL',
        category: 'security',
        status: 'unknown',
        summary: 'Public URL configuration could not be compared.',
        details: ['Review system settings and deployment environment.'],
      });
    }
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  const encryptionValid = Boolean(encryptionKey && /^[0-9a-f]{64}$/i.test(encryptionKey));
  checks.push({
    id: 'encryption',
    label: 'Encryption configuration',
    category: 'security',
    status: encryptionValid
      ? 'healthy'
      : process.env.NODE_ENV === 'development'
        ? 'degraded'
        : 'unhealthy',
    summary: encryptionValid
      ? 'A valid 32-byte hexadecimal encryption key is configured.'
      : 'A valid ENCRYPTION_KEY is not configured.',
    details: ['Key material and fingerprints are never displayed on this page.'],
    commandSnippet: !encryptionValid
      ? {
          command: 'openssl rand -hex 32',
          description: 'Generate 32-byte hexadecimal key for ENCRYPTION_KEY',
          steps: [
            'Generate a secure 32-byte hexadecimal key with "openssl rand -hex 32".',
            'Set "ENCRYPTION_KEY=<generated-key>" in your deployment environment.',
            'Restart the OpsKnight application service.',
          ],
        }
      : undefined,
    telemetry: {
      rawPayload: {
        isConfigured: Boolean(encryptionKey),
        isValidHex64: encryptionValid,
        nodeEnv: process.env.NODE_ENV,
      },
    },
    action: {
      label: 'Encryption guide',
      href: 'https://opsknight.com/docs/v1.3/security/encryption',
    },
  });

  const latest = await latestRelease();
  const comparison = latest ? compareVersions(APP_VERSION, latest) : 0;
  checks.push({
    id: 'version',
    label: 'Version and upgrades',
    category: 'platform',
    status: !latest ? 'unknown' : comparison < 0 ? 'degraded' : 'healthy',
    summary: !latest
      ? `Running ${APP_VERSION}; the latest release could not be checked.`
      : comparison < 0
        ? `Running ${APP_VERSION}; ${latest} is available.`
        : `Running ${APP_VERSION}; no newer stable release was found.`,
    details: [
      'Release discovery uses the public GitHub Releases API and can be unavailable in restricted networks.',
    ],
    telemetry: {
      rawPayload: {
        runningVersion: APP_VERSION,
        latestUpstreamRelease: latest,
        isLatest: comparison >= 0,
      },
    },
    action: {
      label: 'Upgrade runbook',
      href: 'https://opsknight.com/docs/v1.3/deployment/upgrade-rollback',
    },
  });

  const overall = overallStatus(checks);
  const history = await generate24HourHistory(checks, overall, now);

  return { generatedAt: now.toISOString(), overall, checks, history };
}
