import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import prisma from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { getMetricsByIntegration, getMetricsSummary } from '@/lib/integrations/metrics';

export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export type AdminHealthCheck = {
  id: string;
  label: string;
  status: HealthLevel;
  summary: string;
  details: string[];
  action?: { label: string; href: string };
};

export type AdminHealthReport = {
  generatedAt: string;
  overall: HealthLevel;
  checks: AdminHealthCheck[];
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
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
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
  if (checks.some(check => check.status === 'unhealthy')) return 'unhealthy';
  if (checks.some(check => check.status === 'degraded')) return 'degraded';
  if (checks.every(check => check.status === 'unknown')) return 'unknown';
  if (checks.some(check => check.status === 'unknown')) return 'degraded';
  return 'healthy';
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
      label: 'Database',
      status: latency > 1000 ? 'degraded' : 'healthy',
      summary: `PostgreSQL responded in ${latency} ms.`,
      details: [latency > 1000 ? 'Latency exceeds the 1-second health threshold.' : 'Connection check passed.'],
      action: { label: 'Monitoring guide', href: 'https://opsknight.com/docs/v1.3/deployment/monitoring' },
    });
  } catch {
    checks.push({
      id: 'database',
      label: 'Database',
      status: 'unhealthy',
      summary: 'PostgreSQL is unavailable to this application instance.',
      details: ['Check DATABASE_URL, network policy, credentials, TLS, capacity, and PostgreSQL logs.'],
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
      const utilization = capacity
        ? (capacity.usedConnections / Math.max(1, capacity.maxConnections)) * 100
        : 0;
      checks.push({
        id: 'database-capacity',
        label: 'Database capacity',
        status:
          !capacity
            ? 'unknown'
            : utilization >= 95 || capacity.longTransactions > 0
              ? 'unhealthy'
              : utilization >= 80
                ? 'degraded'
                : 'healthy',
        summary: capacity
          ? `${capacity.usedConnections} of ${capacity.maxConnections} connections in use (${Math.round(utilization)}%).`
          : 'Database capacity could not be measured.',
        details: capacity
          ? [
              `Active connections: ${capacity.activeConnections}`,
              `Transactions open longer than 5 minutes: ${capacity.longTransactions}`,
              `Database size: ${byteLabel(Number(capacity.sizeBytes))}`,
              'Host CPU, memory, storage capacity, replicas, and pool wait require external telemetry.',
            ]
          : ['Check PostgreSQL statistics permissions.'],
        action: {
          label: 'Capacity guide',
          href: 'https://opsknight.com/docs/v1.3/core-concepts/scalability',
        },
      });
    } catch {
      checks.push({
        id: 'database-capacity',
        label: 'Database capacity',
        status: 'unknown',
        summary: 'Database capacity statistics could not be read.',
        details: ['The application remains usable; inspect PostgreSQL and platform telemetry directly.'],
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
          ...(failed.length ? [`Failed: ${failed.slice(0, 3).map(row => row.migration_name).join(', ')}`] : []),
        ],
        action: { label: 'Migration runbook', href: 'https://opsknight.com/docs/v1.3/deployment/database-migrations' },
      });
    } catch {
      checks.push({
        id: 'migrations',
        label: 'Database migrations',
        status: 'unknown',
        summary: 'Migration history could not be inspected.',
        details: ['Confirm that the Prisma migration table exists and the application role can read it.'],
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
          ...(state?.lastError ? ['A last-error marker is present; review restricted server logs for details.'] : []),
        ],
        action: { label: 'Maintenance guide', href: 'https://opsknight.com/docs/v1.3/deployment/maintenance' },
      });
    } catch {
      checks.push({
        id: 'scheduler',
        label: 'Scheduler and workers',
        status: 'unknown',
        summary: 'Scheduler state could not be read.',
        details: ['Check migration state and scheduler logs.'],
      });
    }

    try {
      const [pending, processing, failed, overdue, stale] = await Promise.all([
        prisma.backgroundJob.count({ where: { status: 'PENDING' } }),
        prisma.backgroundJob.count({ where: { status: 'PROCESSING' } }),
        prisma.backgroundJob.count({ where: { status: 'FAILED' } }),
        prisma.backgroundJob.count({ where: { status: 'PENDING', scheduledAt: { lt: now } } }),
        prisma.backgroundJob.count({
          where: { status: 'PROCESSING', startedAt: { lt: new Date(now.getTime() - 10 * MINUTE) } },
        }),
      ]);
      checks.push({
        id: 'jobs',
        label: 'Background jobs',
        status: stale > 0 || failed > 0 ? 'unhealthy' : overdue > 0 ? 'degraded' : 'healthy',
        summary: `${pending} pending, ${processing} processing, ${failed} failed.`,
        details: [`Overdue pending: ${overdue}`, `Processing longer than 10 minutes: ${stale}`],
      });
    } catch {
      checks.push({
        id: 'jobs',
        label: 'Background jobs',
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
        status:
          logs.length === 0
            ? 'unknown'
            : slow > 0 || (p95 !== null && p95 > 10_000)
              ? 'degraded'
              : 'healthy',
        summary:
          logs.length === 0
            ? 'No SLA queries were recorded in the last 24 hours.'
            : `${logs.length} queries in 24 hours; p95 ${Math.round(p95 || 0)} ms.`,
        details: [
          `Average: ${average === null ? 'not available' : `${Math.round(average)} ms`}`,
          `p50: ${p50 === null ? 'not available' : `${Math.round(p50)} ms`}`,
          `Queries slower than 10 seconds: ${slow}`,
          `Average incidents evaluated: ${averageIncidents === null ? 'not available' : Math.round(averageIncidents)}`,
        ],
        action: { label: 'SLA analytics', href: '/analytics' },
      });
    } catch {
      checks.push({
        id: 'sla-performance',
        label: 'SLA query performance',
        status: 'unknown',
        summary: 'SLA query performance could not be measured.',
        details: [
          'Confirm the performance-log migration is applied and the application role can read it.',
        ],
      });
    }

    try {
      const [due, locked] = await Promise.all([
        prisma.incident.count({
          where: { escalationStatus: 'ESCALATING', nextEscalationAt: { lte: now } },
        }),
        prisma.incident.count({
          where: {
            escalationStatus: 'ESCALATING',
            escalationProcessingAt: { lt: new Date(now.getTime() - 5 * MINUTE) },
          },
        }),
      ]);
      checks.push({
        id: 'escalations',
        label: 'Escalation backlog',
        status: locked > 0 ? 'unhealthy' : due > 0 ? 'degraded' : 'healthy',
        summary: due === 0 ? 'No escalation steps are overdue.' : `${due} escalation step(s) are due or overdue.`,
        details: [`Stale processing locks: ${locked}`],
        action: { label: 'Open incidents', href: '/incidents?status=OPEN' },
      });
    } catch {
      checks.push({
        id: 'escalations',
        label: 'Escalation backlog',
        status: 'unknown',
        summary: 'Escalation backlog could not be measured.',
        details: ['Check incidents and scheduler health directly.'],
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
          'Run a controlled test incident to verify current schedule coverage and provider delivery.',
        ],
        action: { label: 'Services', href: '/services' },
      });
    } catch {
      checks.push({
        id: 'paging-configuration',
        label: 'Paging configuration coverage',
        status: 'unknown',
        summary: 'Service paging configuration could not be inspected.',
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
        status: incomplete.length > 0 || pending > 0 ? 'unhealthy' : failed > 0 ? 'degraded' : 'healthy',
        summary: `${enabled.length} enabled provider(s); ${failed} failed delivery record(s) in 24 hours.`,
        details: [
          `Pending longer than 5 minutes: ${pending}`,
          `Enabled without configuration: ${incomplete.map(item => item.provider).join(', ') || 'none'}`,
        ],
        action: { label: 'Notification history', href: '/settings/notifications/history' },
      });
    } catch {
      checks.push({
        id: 'notifications',
        label: 'Notification providers',
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
        status: metrics.healthStatus,
        summary: `${enabledIntegrations.length} enabled integration(s); ${metrics.errorRate}% in-process error rate.`,
        details: [
          `Integrations with recorded errors: ${failingIntegrations.map(item => item.name).join(', ') || 'none'}`,
          'Metrics are process-local and reset on restart; durable logs remain authoritative.',
        ],
        action: { label: 'Integration settings', href: '/settings/integrations' },
      });
    } catch {
      checks.push({
        id: 'integrations',
        label: 'Inbound integrations',
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
      const origins = values.map(normalizeOrigin).filter((value): value is string => Boolean(value));
      const consistent = origins.length >= 2 && new Set(origins).size === 1;
      const productionHttps = process.env.NODE_ENV !== 'production' || origins.every(value => value.startsWith('https://'));
      checks.push({
        id: 'public-url',
        label: 'Public URL',
        status: origins.length === 0 || !productionHttps ? 'unhealthy' : consistent ? 'healthy' : 'degraded',
        summary: consistent ? `Canonical origin: ${origins[0]}` : 'Configured public origins do not fully agree.',
        details: [
          `Database setting: ${normalizeOrigin(settings?.appUrl) || 'unset'}`,
          `NEXT_PUBLIC_APP_URL: ${normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) || 'unset'}`,
          `NEXTAUTH_URL: ${normalizeOrigin(process.env.NEXTAUTH_URL) || 'unset'}`,
        ],
        action: { label: 'System settings', href: '/settings/system' },
      });
    } catch {
      checks.push({
        id: 'public-url',
        label: 'Public URL',
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
    status: encryptionValid ? 'healthy' : process.env.NODE_ENV === 'development' ? 'degraded' : 'unhealthy',
    summary: encryptionValid
      ? 'A valid 32-byte hexadecimal encryption key is configured.'
      : 'A valid ENCRYPTION_KEY is not configured.',
    details: ['Key material and fingerprints are never displayed on this page.'],
    action: { label: 'Encryption guide', href: 'https://opsknight.com/docs/v1.3/security/encryption' },
  });

  const memory = process.memoryUsage();
  const heapUtilization = (memory.heapUsed / Math.max(1, memory.heapTotal)) * 100;
  checks.push({
    id: 'runtime',
    label: 'Application runtime',
    status: heapUtilization >= 95 ? 'unhealthy' : heapUtilization >= 85 ? 'degraded' : 'healthy',
    summary: `This process has been running for ${Math.floor(process.uptime() / 60)} minutes; heap utilization is ${Math.round(heapUtilization)}%.`,
    details: [
      `Heap used: ${byteLabel(memory.heapUsed)} of ${byteLabel(memory.heapTotal)}`,
      `Resident memory: ${byteLabel(memory.rss)}`,
      'This is the current application process only; aggregate replica and host metrics externally.',
    ],
    action: {
      label: 'Monitoring guide',
      href: 'https://opsknight.com/docs/v1.3/deployment/monitoring',
    },
  });

  const latest = await latestRelease();
  const comparison = latest ? compareVersions(APP_VERSION, latest) : 0;
  checks.push({
    id: 'version',
    label: 'Version and upgrades',
    status: !latest ? 'unknown' : comparison < 0 ? 'degraded' : 'healthy',
    summary: !latest
      ? `Running ${APP_VERSION}; the latest release could not be checked.`
      : comparison < 0
        ? `Running ${APP_VERSION}; ${latest} is available.`
        : `Running ${APP_VERSION}; no newer stable release was found.`,
    details: ['Release discovery uses the public GitHub Releases API and can be unavailable in restricted networks.'],
    action: { label: 'Upgrade runbook', href: 'https://opsknight.com/docs/v1.3/deployment/upgrade-rollback' },
  });

  return { generatedAt: now.toISOString(), overall: overallStatus(checks), checks };
}
