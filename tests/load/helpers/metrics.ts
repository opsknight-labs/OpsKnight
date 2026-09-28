import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_EMULATOR_ENDPOINTS } from '../fixtures/notification-providers';

const execFileAsync = promisify(execFile);

export interface PostgresTelemetrySnapshot {
  activeConnections: number;
  idleConnections: number;
  idleInTxConnections: number;
  waitingOnLockCount: number;
  advisoryLockCount: number;
  deadlocks: number;
  xactCommit: number;
  xactRollback: number;
  pendingJobsByType: Record<string, number>;
  processingJobsByType: Record<string, number>;
  oldestPendingJobAgeMs: number;
  pendingNotificationsByTrafficClass: Record<string, number>;
  oldestPendingCriticalNotificationAgeMs: number;
  statusPageSnapshotLagSeconds: number;
}

export interface ContainerResourceSample {
  name: string;
  cpuPercent: string;
  memUsage: string;
  memPercent: string;
  restarts?: number;
}

export interface TelemetrySample {
  timestamp: string;
  topology: string;
  stage: string;
  prometheusMetrics: Record<string, number>;
  postgres: PostgresTelemetrySnapshot;
  providers: Record<string, unknown>;
  containers: ContainerResourceSample[];
}

export function parsePrometheusText(raw: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.exec(
      trimmed
    );
    if (match) {
      const val = Number(match[2]);
      if (Number.isFinite(val)) {
        result[match[1]] = val;
      }
    }
  }
  return result;
}

export async function scrapePrometheusEndpoint(
  baseUrl: string,
  metricsToken?: string
): Promise<Record<string, number>> {
  try {
    const headers: Record<string, string> = {};
    if (metricsToken) {
      headers.Authorization = `Bearer ${metricsToken}`;
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/metrics`, {
      headers,
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return {};
    const text = await response.text();
    return parsePrometheusText(text);
  } catch {
    return {};
  }
}

export async function collectPostgresTelemetry(
  prisma: PrismaClient
): Promise<PostgresTelemetrySnapshot> {
  const [
    activityRows,
    lockRows,
    dbRows,
    pendingJobs,
    processingJobs,
    oldestJob,
    pendingNotifications,
    oldestCriticalNotif,
    statusSnapshot,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ state: string | null; wait_event_type: string | null; cnt: bigint }>>`
      SELECT state, wait_event_type, COUNT(*)::bigint AS cnt
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state, wait_event_type
    `,
    prisma.$queryRaw<Array<{ locktype: string; granted: boolean; cnt: bigint }>>`
      SELECT locktype, granted, COUNT(*)::bigint AS cnt
      FROM pg_locks
      GROUP BY locktype, granted
    `,
    prisma.$queryRaw<
      Array<{ xact_commit: bigint; xact_rollback: bigint; deadlocks: bigint }>
    >`
      SELECT xact_commit, xact_rollback, deadlocks
      FROM pg_stat_database
      WHERE datname = current_database()
    `,
    prisma.backgroundJob.groupBy({
      by: ['type'],
      where: { status: { in: ['PENDING', 'PENDING_V2'] } },
      _count: { _all: true },
    }),
    prisma.backgroundJob.groupBy({
      by: ['type'],
      where: { status: { in: ['PROCESSING', 'PROCESSING_V2'] } },
      _count: { _all: true },
    }),
    prisma.backgroundJob.findFirst({
      where: { status: { in: ['PENDING', 'PENDING_V2'] } },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    }),
    prisma.notification.groupBy({
      by: ['trafficClass'],
      where: { status: 'PENDING' },
      _count: { _all: true },
    }),
    prisma.notification.findFirst({
      where: { status: 'PENDING', trafficClass: 'CRITICAL' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.statusPageSnapshot.findFirst({
      where: { statusPageId: 'lt-status-page-001' },
      select: { generatedAt: true },
    }),
  ]);

  let activeConnections = 0;
  let idleConnections = 0;
  let idleInTxConnections = 0;
  let waitingOnLockCount = 0;

  for (const row of activityRows) {
    const count = Number(row.cnt);
    if (row.state === 'active') activeConnections += count;
    else if (row.state === 'idle') idleConnections += count;
    else if (row.state?.startsWith('idle in transaction')) idleInTxConnections += count;
    if (row.wait_event_type === 'Lock') waitingOnLockCount += count;
  }

  let advisoryLockCount = 0;
  for (const row of lockRows) {
    if (row.locktype === 'advisory') {
      advisoryLockCount += Number(row.cnt);
    }
  }

  const dbStat = dbRows[0];
  const pendingJobsByType: Record<string, number> = {};
  for (const row of pendingJobs) {
    pendingJobsByType[row.type] = row._count._all;
  }

  const processingJobsByType: Record<string, number> = {};
  for (const row of processingJobs) {
    processingJobsByType[row.type] = row._count._all;
  }

  const pendingNotificationsByTrafficClass: Record<string, number> = {};
  for (const row of pendingNotifications) {
    pendingNotificationsByTrafficClass[row.trafficClass] = row._count._all;
  }

  const now = Date.now();
  const oldestPendingJobAgeMs = oldestJob
    ? Math.max(0, now - oldestJob.scheduledAt.getTime())
    : 0;
  const oldestPendingCriticalNotificationAgeMs = oldestCriticalNotif
    ? Math.max(0, now - oldestCriticalNotif.createdAt.getTime())
    : 0;
  const statusPageSnapshotLagSeconds = statusSnapshot?.generatedAt
    ? Math.max(0, Math.round((now - statusSnapshot.generatedAt.getTime()) / 1000))
    : 0;

  return {
    activeConnections,
    idleConnections,
    idleInTxConnections,
    waitingOnLockCount,
    advisoryLockCount,
    deadlocks: dbStat ? Number(dbStat.deadlocks) : 0,
    xactCommit: dbStat ? Number(dbStat.xact_commit) : 0,
    xactRollback: dbStat ? Number(dbStat.xact_rollback) : 0,
    pendingJobsByType,
    processingJobsByType,
    oldestPendingJobAgeMs,
    pendingNotificationsByTrafficClass,
    oldestPendingCriticalNotificationAgeMs,
    statusPageSnapshotLagSeconds,
  };
}

export async function collectContainerStats(
  k8sNamespace?: string
): Promise<ContainerResourceSample[]> {
  if (k8sNamespace) {
    try {
      const { stdout } = await execFileAsync('kubectl', [
        'top',
        'pods',
        '-n',
        k8sNamespace,
        '--no-headers',
      ]);
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            name: parts[0] ?? 'unknown',
            cpuPercent: parts[1] ?? '0m',
            memUsage: parts[2] ?? '0Mi',
            memPercent: 'n/a',
          };
        });
    } catch {
      // Fallback to docker stats if metrics-server isn't installed in Kind
    }
  }

  try {
    const { stdout } = await execFileAsync('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}',
    ]);
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, cpuPercent, memUsage, memPercent] = line.split('\t');
        return {
          name: name ?? 'unknown',
          cpuPercent: cpuPercent ?? '0%',
          memUsage: memUsage ?? '0B',
          memPercent: memPercent ?? '0%',
        };
      });
  } catch {
    return [];
  }
}

export async function collectProviderTelemetry(
  controlBaseUrl = DEFAULT_EMULATOR_ENDPOINTS.controlBaseUrl
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${controlBaseUrl.replace(/\/$/, '')}/metrics`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return {};
    const body = (await response.json()) as { providers?: Record<string, unknown> };
    return body.providers ?? {};
  } catch {
    return {};
  }
}

export async function collectSingleTelemetrySample(options: {
  prisma: PrismaClient;
  topology: string;
  stage: string;
  baseUrl: string;
  metricsToken?: string;
  controlBaseUrl?: string;
  k8sNamespace?: string;
}): Promise<TelemetrySample> {
  const [prometheusMetrics, postgres, providers, containers] = await Promise.all([
    scrapePrometheusEndpoint(options.baseUrl, options.metricsToken),
    collectPostgresTelemetry(options.prisma),
    collectProviderTelemetry(options.controlBaseUrl),
    collectContainerStats(options.k8sNamespace),
  ]);

  return {
    timestamp: new Date().toISOString(),
    topology: options.topology,
    stage: options.stage,
    prometheusMetrics,
    postgres,
    providers,
    containers,
  };
}

export async function startContinuousTelemetryCollector(options: {
  topology: string;
  stage: string;
  baseUrl: string;
  outputDir: string;
  intervalMs?: number;
  metricsToken?: string;
  controlBaseUrl?: string;
  k8sNamespace?: string;
}): Promise<{
  stop: () => Promise<TelemetrySample[]>;
}> {
  const prisma = new PrismaClient();
  const samples: TelemetrySample[] = [];
  const intervalMs = options.intervalMs ?? 5_000;
  const jsonlPath = path.join(options.outputDir, 'metrics-timeseries.jsonl');
  await fs.mkdir(options.outputDir, { recursive: true });

  let running = true;
  const loopPromise = (async () => {
    while (running) {
      try {
        const sample = await collectSingleTelemetrySample({
          prisma,
          topology: options.topology,
          stage: options.stage,
          baseUrl: options.baseUrl,
          metricsToken: options.metricsToken,
          controlBaseUrl: options.controlBaseUrl,
          k8sNamespace: options.k8sNamespace,
        });
        samples.push(sample);
        await fs.appendFile(jsonlPath, `${JSON.stringify(sample)}\n`, 'utf8');
      } catch {
        // Ignore transient scrape errors during chaos/recovery drills
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  })();

  return {
    stop: async () => {
      running = false;
      await loopPromise;
      await prisma.$disconnect();
      return samples;
    },
  };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  const topology = process.env.LOAD_TOPOLOGY || 'manual';
  const stage = process.env.LOAD_STAGE || 'snapshot';
  const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
  const outputDir = path.resolve(
    process.cwd(),
    process.env.LOAD_OUTPUT_DIR || `artifacts/load-certification/${topology}`
  );

  collectSingleTelemetrySample({
    prisma,
    topology,
    stage,
    baseUrl,
    metricsToken: process.env.METRICS_TOKEN,
  })
    .then(async sample => {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(
        path.join(outputDir, `metrics-${stage}.json`),
        JSON.stringify(sample, null, 2),
        'utf8'
      );
      console.log(
        JSON.stringify({
          event: 'load_metrics.snapshot',
          topology,
          stage,
          activeConnections: sample.postgres.activeConnections,
          oldestPendingJobAgeMs: sample.postgres.oldestPendingJobAgeMs,
          containers: sample.containers.length,
        })
      );
    })
    .finally(() => prisma.$disconnect());
}
