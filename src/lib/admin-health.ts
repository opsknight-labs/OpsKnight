import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import prisma from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { getMetricsByIntegration, getMetricsSummary } from '@/lib/integrations/metrics';
import { getJobWorkerStatus } from '@/lib/job-worker';
import { getRealtimeControlPlaneStatus } from '@/lib/realtime-change-control-plane';

export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'informational';
export type HealthCategory = 'database' | 'workers' | 'alerting' | 'security' | 'platform';

/** Stable documentation channel; never pin health remediation to an aging release. */
export const ADMIN_HEALTH_GUIDES = {
  monitoring: 'https://opsknight.com/docs/latest/deployment/monitoring/',
  scalability: 'https://opsknight.com/docs/latest/core-concepts/scalability/',
  migrations: 'https://opsknight.com/docs/latest/deployment/database-migrations/',
  maintenance: 'https://opsknight.com/docs/latest/deployment/maintenance/',
  sla: 'https://opsknight.com/docs/latest/core-concepts/analytics/',
  encryption: 'https://opsknight.com/docs/latest/security/encryption/',
  upgrades: 'https://opsknight.com/docs/latest/deployment/upgrade-rollback/',
} as const;

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
    windowLabel?: '1h' | '24h';
    p95Ms24h?: number | null;
    sampleCount24h?: number;
    maxMs?: number | null;
    slowCount?: number;
    slowRate24h?: number;
    trend?: 'improving' | 'stable' | 'regressing' | 'insufficient-data';
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
  /** Where the evidence originates. Prevents replica-local state being mistaken for cluster truth. */
  scope?: 'cluster' | 'replica' | 'configuration' | 'external';
  observedAt?: string;
  impact?: string;
  /** False for informative signals that are not expected on every deployment role. */
  required?: boolean;
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
  durationMs?: number;
  overall: HealthLevel;
  scorePercent?: number;
  knownSignalPercent?: number;
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

type SlaPerformanceSummaryRow = {
  sampleCount24h: number;
  sampleCount1h: number;
  p50Ms24h: number | null;
  p95Ms24h: number | null;
  avgMs24h: number | null;
  maxMs24h: number | null;
  slowCount24h: number;
  avgIncidents24h: number | null;
  p50Ms1h: number | null;
  p95Ms1h: number | null;
  p95MsPrior23h: number | null;
  avgMs1h: number | null;
  maxMs1h: number | null;
  slowCount1h: number;
  avgIncidents1h: number | null;
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

export function healthDurationLabel(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined) return 'no samples';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < MINUTE) return `${(milliseconds / 1000).toFixed(1)} s`;
  const minutes = Math.floor(milliseconds / MINUTE);
  const seconds = Math.round((milliseconds % MINUTE) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Keep diagnostics actionable without reflecting credentials, URLs, or driver internals. */
function safeErrorKind(error: unknown): string {
  if (!(error instanceof Error)) return 'Unexpected database error';
  const name = error.name.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80);
  return name
    ? `${name} (see restricted server logs)`
    : 'Database error (see restricted server logs)';
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

export const CHECK_WEIGHTS: Record<string, number> = {
  // Critical Infrastructure (Weight 10)
  database: 10,
  migrations: 10,
  encryption: 10,
  scheduler: 10,
  // Core Operational Services (Weight 5)
  jobs: 5,
  escalations: 5,
  'database-capacity': 5,
  rollups: 5,
  'integration-control-plane': 5,
  'worker-replica': 3,
  realtime: 3,
  // Auxiliary & Delivery Services (Weight 3)
  notifications: 3,
  integrations: 3,
  'public-url': 3,
  // Advisory & Telemetry (Weight 1)
  'sla-performance': 1,
  'paging-configuration': 1,
  version: 1,
};

export type OperationalScoreResult = {
  scorePercent: number;
  overall: HealthLevel;
  criticalIssues: AdminHealthCheck[];
  warningIssues: AdminHealthCheck[];
};

export function calculateOperationalScore(checks: AdminHealthCheck[]): OperationalScoreResult {
  if (checks.length === 0) {
    return { scorePercent: 100, overall: 'unknown', criticalIssues: [], warningIssues: [] };
  }

  let totalWeight = 0;
  let weightedScore = 0;
  const criticalIssues: AdminHealthCheck[] = [];
  const warningIssues: AdminHealthCheck[] = [];

  for (const check of checks) {
    const weight = CHECK_WEIGHTS[check.id] ?? 3;
    const isCritical = weight >= 10;

    totalWeight += weight;

    if (check.status === 'unhealthy') {
      if (isCritical) {
        criticalIssues.push(check);
      } else {
        warningIssues.push(check);
      }
    } else if (check.status === 'degraded') {
      warningIssues.push(check);
      weightedScore += weight * 0.75;
    } else if (check.status === 'healthy' || check.status === 'informational') {
      weightedScore += weight * 1.0;
    } else {
      // Unknown evidence must never inflate health. It is uncertainty, not success.
      if (check.required === false) {
        weightedScore += weight;
      } else {
        warningIssues.push(check);
        weightedScore += weight * 0.5;
      }
    }
  }

  const scorePercent =
    totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 1000) / 10 : 100;

  let overall: HealthLevel = 'healthy';
  if (criticalIssues.length > 0 || scorePercent < 80) {
    overall = 'unhealthy';
  } else if (warningIssues.length > 0 || scorePercent < 98) {
    overall = 'degraded';
  }

  return { scorePercent, overall, criticalIssues, warningIssues };
}

export function overallStatus(checks: AdminHealthCheck[]): HealthLevel {
  return calculateOperationalScore(checks).overall;
}

export async function generate24HourHistory(
  checks: AdminHealthCheck[],
  overall: HealthLevel,
  now: Date
): Promise<HealthHistorySample[]> {
  const since = new Date(now.getTime() - 24 * HOUR);

  type FailedJob = {
    id: string;
    createdAt: Date;
  };
  type FailedDelivery = {
    id: string;
    createdAt: Date;
  };
  type FailedNotification = {
    id: string;
    startedAt: Date;
  };

  const historyResults = await Promise.allSettled([
    prisma.backgroundJob.findMany({
      where: {
        createdAt: { gte: since },
        status: 'FAILED',
      },
      select: { id: true, createdAt: true },
    }),
    prisma.inboundDelivery.findMany({
      where: {
        createdAt: { gte: since },
        status: 'FAILED',
      },
      select: { id: true, createdAt: true },
    }),
    prisma.notificationDeliveryAttempt.findMany({
      where: {
        startedAt: { gte: since },
        outcome: 'FAILED',
      },
      select: { id: true, startedAt: true },
    }),
  ]);
  const [jobResult, deliveryResult, notificationResult] = historyResults;
  const failedJobs: FailedJob[] = jobResult.status === 'fulfilled' ? jobResult.value : [];
  const failedDeliveries: FailedDelivery[] =
    deliveryResult.status === 'fulfilled' ? deliveryResult.value : [];
  const failedNotifications: FailedNotification[] =
    notificationResult.status === 'fulfilled' ? notificationResult.value : [];
  const unavailableSources = historyResults.filter(result => result.status === 'rejected').length;

  const {
    scorePercent: liveScorePercent,
    criticalIssues,
    warningIssues,
  } = calculateOperationalScore(checks);

  const topCriticalIssue = criticalIssues[0]?.summary;
  const topWarningIssue = warningIssues[0]?.summary;

  const samples: HealthHistorySample[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * HOUR);
    const windowStart = new Date(d.getTime() - HOUR);
    const windowEnd = d;
    const hour = d.getHours();
    const hourLabel = `${hour.toString().padStart(2, '0')}:00`;

    // Customer/service incidents are intentionally excluded: they describe the
    // monitored estate, not whether OpsKnight itself was available.
    const hourlyFailedJobs = failedJobs.filter(
      j =>
        j.createdAt.getTime() >= windowStart.getTime() &&
        j.createdAt.getTime() < windowEnd.getTime()
    );

    const hourlyFailedDeliveries = failedDeliveries.filter(
      del =>
        del.createdAt.getTime() >= windowStart.getTime() &&
        del.createdAt.getTime() < windowEnd.getTime()
    );

    const hourlyFailedNotifications = failedNotifications.filter(
      notif =>
        notif.startedAt.getTime() >= windowStart.getTime() &&
        notif.startedAt.getTime() < windowEnd.getTime()
    );

    let status: HealthLevel = 'healthy';
    let scorePercent = 100;
    let reason = 'All systems operating normally';

    if (hourlyFailedJobs.length > 0) {
      status = 'degraded';
      scorePercent = Math.max(70, 100 - hourlyFailedJobs.length * 10);
      reason = `${hourlyFailedJobs.length} background job failure(s)`;
    } else if (hourlyFailedDeliveries.length > 0 || hourlyFailedNotifications.length > 0) {
      status = 'degraded';
      const totalErrors = hourlyFailedDeliveries.length + hourlyFailedNotifications.length;
      scorePercent = Math.max(75, 100 - totalErrors * 5);
      reason = `${totalErrors} delivery error(s)`;
    } else if (i === 0) {
      // Current live hour reflects live weighted diagnostic score
      status = overall;
      scorePercent = liveScorePercent;
      reason =
        overall === 'healthy'
          ? 'All diagnostic signals passing'
          : topCriticalIssue ||
            topWarningIssue ||
            (overall === 'degraded' ? 'Operational with warnings' : 'Critical diagnostic error');
    } else if (unavailableSources > 0) {
      status = 'unknown';
      scorePercent = 0;
      reason = `${unavailableSources} historical evidence source(s) unavailable`;
    } else {
      status = 'healthy';
      scorePercent = 100;
      reason = 'No durable job or delivery failures recorded';
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

const HEALTH_CACHE_TTL_MS = 15_000;
let cachedHealthReport: { report: AdminHealthReport; expiresAt: number } | null = null;
let healthCollectionInFlight: Promise<AdminHealthReport> | null = null;

async function collectAdminHealthUncached(): Promise<AdminHealthReport> {
  const collectionStartedAt = Date.now();
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
        href: ADMIN_HEALTH_GUIDES.monitoring,
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
        `Error class: ${safeErrorKind(error)}`,
      ],
      telemetry: {
        rawPayload: {
          errorClass: safeErrorKind(error),
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
        scope: 'cluster',
        observedAt: now.toISOString(),
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
          href: ADMIN_HEALTH_GUIDES.scalability,
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
          href: ADMIN_HEALTH_GUIDES.migrations,
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
          href: ADMIN_HEALTH_GUIDES.maintenance,
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
      const since24h = new Date(now.getTime() - 24 * HOUR);
      const since1h = new Date(now.getTime() - HOUR);
      const [metrics] = await prisma.$queryRaw<SlaPerformanceSummaryRow[]>`
        SELECT
          COUNT(*)::int AS "sampleCount24h",
          COUNT(*) FILTER (WHERE timestamp >= ${since1h})::int AS "sampleCount1h",
          percentile_cont(0.50) WITHIN GROUP (ORDER BY "durationMs")::double precision AS "p50Ms24h",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")::double precision AS "p95Ms24h",
          AVG("durationMs")::double precision AS "avgMs24h",
          MAX("durationMs")::int AS "maxMs24h",
          COUNT(*) FILTER (WHERE "durationMs" > 10000)::int AS "slowCount24h",
          AVG("incidentCount")::double precision AS "avgIncidents24h",
          percentile_cont(0.50) WITHIN GROUP (ORDER BY "durationMs")
            FILTER (WHERE timestamp >= ${since1h})::double precision AS "p50Ms1h",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")
            FILTER (WHERE timestamp >= ${since1h})::double precision AS "p95Ms1h",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")
            FILTER (WHERE timestamp < ${since1h})::double precision AS "p95MsPrior23h",
          AVG("durationMs") FILTER (WHERE timestamp >= ${since1h})::double precision AS "avgMs1h",
          MAX("durationMs") FILTER (WHERE timestamp >= ${since1h})::int AS "maxMs1h",
          COUNT(*) FILTER (WHERE timestamp >= ${since1h} AND "durationMs" > 10000)::int AS "slowCount1h",
          AVG("incidentCount") FILTER (WHERE timestamp >= ${since1h})::double precision AS "avgIncidents1h"
        FROM sla_performance_logs
        WHERE timestamp >= ${since24h}
      `;
      const sampleCount24h = metrics?.sampleCount24h ?? 0;
      const sampleCount1h = metrics?.sampleCount1h ?? 0;
      const recentP95 = metrics?.p95Ms1h ?? null;
      const dailyP95 = metrics?.p95Ms24h ?? null;
      const priorP95 = metrics?.p95MsPrior23h ?? null;
      const trend =
        recentP95 === null || priorP95 === null || priorP95 === 0
          ? 'insufficient-data'
          : recentP95 > priorP95 * 1.2
            ? 'regressing'
            : recentP95 < priorP95 * 0.8
              ? 'improving'
              : 'stable';
      const displayedP95 = recentP95 ?? dailyP95;
      const displayedP50 = metrics?.p50Ms1h ?? metrics?.p50Ms24h ?? null;
      const displayedAverage = metrics?.avgMs1h ?? metrics?.avgMs24h ?? null;
      const displayWindow = sampleCount1h > 0 ? '1h' : '24h';
      const slowRate24h =
        sampleCount24h > 0
          ? Math.round(((metrics?.slowCount24h ?? 0) / sampleCount24h) * 1000) / 10
          : 0;

      checks.push({
        id: 'sla-performance',
        label: 'SLA query performance',
        category: 'workers',
        status:
          sampleCount24h === 0
            ? 'unknown'
            : (metrics?.slowCount1h ?? 0) > 0 || (displayedP95 !== null && displayedP95 > 10_000)
              ? 'degraded'
              : 'healthy',
        summary:
          sampleCount24h === 0
            ? 'No recent SLA query timing data.'
            : sampleCount1h > 0
              ? `${sampleCount1h} queries in the last hour; p95 ${healthDurationLabel(displayedP95)} (${trend} vs prior 23h).`
              : `No executions in the last hour; historical 24h p95 was ${healthDurationLabel(dailyP95)}.`,
        details:
          sampleCount24h === 0
            ? ['SLA performance metrics require recorded calculation events.']
            : [
                `24 hours: ${sampleCount24h} queries, p50 ${healthDurationLabel(metrics?.p50Ms24h)}, p95 ${healthDurationLabel(dailyP95)}, max ${healthDurationLabel(metrics?.maxMs24h)}`,
                `Slow queries over 10s: ${metrics?.slowCount24h ?? 0} (${slowRate24h}%) in 24h`,
                ...(sampleCount1h > 0
                  ? [
                      `Last hour: p50 ${healthDurationLabel(metrics?.p50Ms1h)}, average ${healthDurationLabel(metrics?.avgMs1h)}, max ${healthDurationLabel(metrics?.maxMs1h)}`,
                      `Last-hour slow queries: ${metrics?.slowCount1h ?? 0}; execution rate: ${(sampleCount1h / 60).toFixed(1)} per minute`,
                      `Average incidents scanned: ${Math.round(metrics?.avgIncidents1h ?? 0)} in 1h / ${Math.round(metrics?.avgIncidents24h ?? 0)} in 24h`,
                    ]
                  : [
                      'Last hour: no timing samples; current SLA-query performance is not established.',
                      `Average incidents scanned per historical run: ${Math.round(metrics?.avgIncidents24h ?? 0)}`,
                    ]),
              ],
        telemetry: {
          slaMetrics: {
            p95Ms: displayedP95,
            p50Ms: displayedP50,
            avgMs: displayedAverage === null ? null : Math.round(displayedAverage),
            sampleCount: displayWindow === '1h' ? sampleCount1h : sampleCount24h,
            windowLabel: displayWindow,
            p95Ms24h: dailyP95,
            sampleCount24h,
            maxMs: metrics?.maxMs1h ?? metrics?.maxMs24h ?? null,
            slowCount:
              displayWindow === '1h' ? (metrics?.slowCount1h ?? 0) : (metrics?.slowCount24h ?? 0),
            trend,
            slowRate24h,
          },
          rawPayload: {
            window1h: {
              sampleCount: sampleCount1h,
              p50Ms: metrics?.p50Ms1h ?? null,
              p95Ms: recentP95,
              p95MsPrior23h: priorP95,
              averageMs: metrics?.avgMs1h ?? null,
              maxMs: metrics?.maxMs1h ?? null,
              slowQueriesCount: metrics?.slowCount1h ?? 0,
              averageIncidentsScanned: metrics?.avgIncidents1h ?? null,
              executionsPerMinute: sampleCount1h / 60,
            },
            window24h: {
              sampleCount: sampleCount24h,
              p50Ms: metrics?.p50Ms24h ?? null,
              p95Ms: dailyP95,
              averageMs: metrics?.avgMs24h ?? null,
              maxMs: metrics?.maxMs24h ?? null,
              slowQueriesCount: metrics?.slowCount24h ?? 0,
              averageIncidentsScanned: metrics?.avgIncidents24h ?? null,
            },
            trend,
          },
        },
        action: {
          label: 'SLA guide',
          href: ADMIN_HEALTH_GUIDES.sla,
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
    scope: 'configuration',
    observedAt: now.toISOString(),
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
      href: ADMIN_HEALTH_GUIDES.encryption,
    },
  });

  const latest = await latestRelease();
  const comparison = latest ? compareVersions(APP_VERSION, latest) : 0;
  checks.push({
    id: 'version',
    label: 'Version and upgrades',
    category: 'platform',
    scope: 'external',
    observedAt: now.toISOString(),
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
      href: ADMIN_HEALTH_GUIDES.upgrades,
    },
  });

  // These signals close important blind spots in the durable control planes. They are
  // deliberately collected after the baseline checks so a single optional subsystem
  // can report "unknown" without preventing the rest of the page from rendering.
  if (databaseAvailable) {
    try {
      const [rollup, staleExternalOperations, failedExternalOperations, staleInbound] =
        await Promise.all([
          prisma.incidentMetricRollup.findFirst({
            where: { granularity: 'daily', serviceId: null, teamId: null },
            orderBy: { date: 'desc' },
            select: { date: true, updatedAt: true },
          }),
          prisma.externalOperation.count({
            where: {
              status: { in: ['PENDING', 'PROCESSING', 'AMBIGUOUS'] },
              updatedAt: { lt: new Date(now.getTime() - 15 * MINUTE) },
            },
          }),
          prisma.externalOperation.count({
            where: { status: 'FAILED', updatedAt: { gte: new Date(now.getTime() - 24 * HOUR) } },
          }),
          prisma.inboundDelivery.count({
            where: {
              status: 'PROCESSING',
              updatedAt: { lt: new Date(now.getTime() - 10 * MINUTE) },
            },
          }),
        ]);
      const expectedLatestDay = new Date(now);
      expectedLatestDay.setUTCHours(0, 0, 0, 0);
      expectedLatestDay.setUTCDate(expectedLatestDay.getUTCDate() - 1);
      const rollupLagDays = rollup
        ? Math.max(
            0,
            Math.floor((expectedLatestDay.getTime() - rollup.date.getTime()) / (24 * HOUR))
          )
        : null;
      checks.push({
        id: 'rollups',
        label: 'Analytics rollup freshness',
        category: 'workers',
        scope: 'cluster',
        observedAt: now.toISOString(),
        status:
          rollupLagDays === null
            ? 'unknown'
            : rollupLagDays > 1
              ? 'unhealthy'
              : rollupLagDays > 0
                ? 'degraded'
                : 'healthy',
        summary: rollup
          ? `Latest complete daily rollup is ${rollupLagDays} day(s) behind.`
          : 'No complete daily analytics rollup was found.',
        details: [
          `Latest rollup day: ${rollup?.date.toISOString() || 'none'}`,
          `Last materialized: ${rollup?.updatedAt.toISOString() || 'never'}`,
        ],
        impact: 'Stale rollups can make historical reports and executive dashboards incomplete.',
        telemetry: {
          rawPayload: { rollupLagDays, latestDate: rollup?.date.toISOString() || null },
        },
      });
      checks.push({
        id: 'integration-control-plane',
        label: 'Integration delivery control plane',
        category: 'alerting',
        scope: 'cluster',
        observedAt: now.toISOString(),
        status:
          staleExternalOperations > 0 || staleInbound > 0
            ? 'unhealthy'
            : failedExternalOperations > 0
              ? 'degraded'
              : 'healthy',
        summary: `${staleExternalOperations} stale external operation(s), ${staleInbound} stale inbound delivery lease(s).`,
        details: [
          `Terminal external failures in 24 hours: ${failedExternalOperations}`,
          'Durable database state is cluster-wide and survives replica restarts.',
        ],
        impact:
          'Stale work delays inbound alerts, ChatOps responses, or external issue synchronization.',
        telemetry: {
          rawPayload: {
            staleExternalOperations,
            failedExternalOperations24h: failedExternalOperations,
            staleInboundDeliveries: staleInbound,
          },
        },
      });
    } catch {
      checks.push({
        id: 'control-plane-storage',
        label: 'Durable control-plane telemetry',
        category: 'workers',
        scope: 'cluster',
        observedAt: now.toISOString(),
        status: 'unknown',
        summary: 'Durable rollup and integration state could not be inspected.',
        details: ['Verify migrations and database permissions for control-plane tables.'],
      });
    }
  }

  const worker = getJobWorkerStatus();
  const workerSuccessAgeMs = worker.lastSuccessAt
    ? now.getTime() - worker.lastSuccessAt.getTime()
    : null;
  checks.push({
    id: 'worker-replica',
    label: 'Local durable-job worker',
    category: 'workers',
    scope: 'replica',
    required: false,
    observedAt: now.toISOString(),
    status: !worker.running
      ? 'informational'
      : worker.lastError || workerSuccessAgeMs === null || workerSuccessAgeMs > 5 * MINUTE
        ? 'degraded'
        : 'healthy',
    summary: !worker.running
      ? 'This web replica does not run the durable-job worker.'
      : workerSuccessAgeMs === null
        ? 'The local worker has not completed a successful cycle.'
        : `The local worker last succeeded ${ageLabel(worker.lastSuccessAt)}.`,
    details: [
      `Running on this replica: ${worker.running ? 'yes' : 'no'}`,
      `In flight: ${worker.inFlight ? 'yes' : 'no'}`,
      'A non-running local worker is informational when dedicated worker replicas are deployed.',
    ],
    impact:
      'Use cluster queue age together with this replica signal to determine actual delivery health.',
    telemetry: {
      rawPayload: {
        running: worker.running,
        inFlight: worker.inFlight,
        lastRunAt: worker.lastRunAt?.toISOString() || null,
        lastSuccessAt: worker.lastSuccessAt?.toISOString() || null,
        hasLastError: Boolean(worker.lastError),
      },
    },
  });

  const realtime = getRealtimeControlPlaneStatus();
  checks.push({
    id: 'realtime',
    label: 'Realtime event control plane',
    category: 'workers',
    scope: 'replica',
    observedAt: now.toISOString(),
    status:
      realtime.consecutiveFailures > 2
        ? 'unhealthy'
        : realtime.consecutiveFailures > 0
          ? 'degraded'
          : 'healthy',
    summary:
      realtime.consecutiveFailures > 0
        ? `${realtime.consecutiveFailures} consecutive change-feed polling failure(s) on this replica.`
        : 'The local realtime change feed has no recorded polling failures.',
    details: [
      `Connected subscribers on this replica: ${realtime.subscribers}`,
      `Observed generation: ${realtime.observedGeneration || 'not yet observed'}`,
      `Last temporal reconciliation: ${realtime.lastReconciliationAt || 'not started'}`,
    ],
    impact:
      'Repeated failures delay dashboard and widget refreshes; durable data remains authoritative.',
    telemetry: { rawPayload: realtime },
  });

  for (const check of checks) {
    check.observedAt ??= now.toISOString();
    check.scope ??=
      check.id === 'version'
        ? 'external'
        : check.id === 'integrations'
          ? 'replica'
          : check.id === 'public-url' || check.id === 'encryption'
            ? 'configuration'
            : 'cluster';
  }

  const score = calculateOperationalScore(checks);
  const overall = score.overall;
  const history = await generate24HourHistory(checks, overall, now);
  const requiredChecks = checks.filter(check => check.required !== false);
  const knownChecks = requiredChecks.filter(check => check.status !== 'unknown').length;

  return {
    generatedAt: now.toISOString(),
    durationMs: Date.now() - collectionStartedAt,
    overall,
    scorePercent: score.scorePercent,
    knownSignalPercent: Math.round((knownChecks / Math.max(1, requiredChecks.length)) * 1000) / 10,
    checks,
    history,
  };
}

/**
 * A health page must not become a database load generator. One collection may
 * contain several independent diagnostics, so requests on a replica share a
 * short-lived snapshot and a single in-flight collection. `force` bypasses an
 * existing snapshot but still joins an already-running collection.
 */
export async function collectAdminHealth(options?: {
  force?: boolean;
}): Promise<AdminHealthReport> {
  const now = Date.now();
  if (!options?.force && cachedHealthReport && cachedHealthReport.expiresAt > now) {
    return cachedHealthReport.report;
  }
  if (healthCollectionInFlight) return healthCollectionInFlight;

  healthCollectionInFlight = collectAdminHealthUncached()
    .then(report => {
      cachedHealthReport = { report, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS };
      return report;
    })
    .finally(() => {
      healthCollectionInFlight = null;
    });
  return healthCollectionInFlight;
}

export function resetAdminHealthCacheForTests(): void {
  cachedHealthReport = null;
  healthCollectionInFlight = null;
}
