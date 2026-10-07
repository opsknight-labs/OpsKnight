import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { configureAutomationLoadProfile } from './automation';
import { AUTOMATION_LOAD_PROFILES } from '../fixtures/automation';
import { collectSingleTelemetrySample } from './metrics';
import type { LoadSeedManifest } from './seed';
const exec = promisify(execFile);
const db = new PrismaClient();
const composeArgs = [
  'compose',
  '-p',
  'opsknight-automation-cert',
  '-f',
  'tests/load/deploy/compose/automation.yml',
];
async function runK6(profile: string, output: string) {
  const child = spawn(
    process.env.K6_BINARY || 'k6',
    ['run', '--summary-export', output, 'tests/load/scenarios/automation.js'],
    {
      env: {
        ...process.env,
        AUTOMATION_LOAD_PROFILE: profile,
        AUTOMATION_RUN_ID: String(Date.now()),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const chunks: string[] = [];
  child.stdout.on('data', chunk => chunks.push(String(chunk)));
  child.stderr.on('data', chunk => chunks.push(String(chunk)));
  let faultWork: Promise<unknown> | null = null;
  const fault =
    profile === 'live-small' && process.env.AUTOMATION_RECOVERY_DRILL === 'true'
      ? setTimeout(() => {
          faultWork = Promise.all(
            ['web', 'critical', 'general'].map(async role => {
              const namespace = process.env.AUTOMATION_K8S_NAMESPACE;
              if (namespace) {
                const component = role === 'web' ? role : `${role}-worker`;
                const { stdout } = await exec('kubectl', [
                  'get',
                  'pods',
                  '-n',
                  namespace,
                  '-l',
                  `app.kubernetes.io/component=${component}`,
                  '-o',
                  'jsonpath={.items[0].metadata.name}',
                ]);
                if (stdout.trim()) {
                  chunks.push(`Deleting one ${role} pod ${stdout.trim()}\n`);
                  await exec('kubectl', [
                    'delete',
                    'pod',
                    '-n',
                    namespace,
                    stdout.trim(),
                    '--grace-period=0',
                    '--force',
                    '--wait=false',
                  ]);
                }
              } else {
                const { stdout } = await exec('docker', [...composeArgs, 'ps', '-q', role]);
                const id = stdout.trim().split('\n')[0];
                if (id) {
                  chunks.push(`Restarting one ${role} replica ${id}\n`);
                  await exec('docker', ['restart', '--time', '0', id]);
                }
              }
            })
          );
        }, 5000)
      : null;
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (fault) clearTimeout(fault);
  if (faultWork) await faultWork;
  await fs.writeFile(output.replace('.json', '.log'), chunks.join(''));
  if (code !== 0) throw new Error(`k6 ${profile} failed (${code}); inspect ${output}`);
}
async function main() {
  if (process.env.OPSKNIGHT_LOAD_CERT_DB !== 'true')
    throw new Error('Use an explicitly isolated load database with OPSKNIGHT_LOAD_CERT_DB=true');
  const manifestPath = path.resolve(
    process.env.LOAD_SEED_MANIFEST || 'artifacts/load-certification/automation/seed-manifest.json'
  );
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as LoadSeedManifest;
  const actor = await db.user.findFirstOrThrow({
    where: { id: { in: manifest.userIds }, role: 'ADMIN' },
  });
  const topology = process.env.AUTOMATION_TOPOLOGY || 'compose-split';
  const outputDir = path.resolve('artifacts/load-certification/automation', topology);
  await fs.mkdir(outputDir, { recursive: true });
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const results = [];
  for (const profile of AUTOMATION_LOAD_PROFILES) {
    await configureAutomationLoadProfile(db, manifest.allServiceIds, actor.id, profile);
    const [before] = await db.$queryRaw<
      Array<{ deadlocks: bigint }>
    >`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`;
    const started = new Date();
    const summaryPath = path.join(outputDir, `${profile}.json`);
    const samples: Awaited<ReturnType<typeof collectSingleTelemetrySample>>[] = [];
    let sampling = false;
    let inFlightSample: Promise<void> | undefined;
    const sample = async () => {
      if (sampling) return;
      sampling = true;
      try {
        samples.push(
          await collectSingleTelemetrySample({
            prisma: db,
            topology,
            stage: profile,
            baseUrl: process.env.BASE_URL || manifest.baseUrl,
            controlBaseUrl: process.env.LOAD_EMULATOR_CONTROL_URL,
            metricsToken: process.env.LOAD_METRICS_TOKEN,
            k8sNamespace: process.env.AUTOMATION_K8S_NAMESPACE,
          })
        );
      } finally {
        sampling = false;
      }
    };
    await sample();
    const timer = setInterval(() => {
      if (!sampling) inFlightSample = sample();
    }, 5000);
    try {
      await runK6(profile, summaryPath);
    } finally {
      clearInterval(timer);
      await inFlightSample;
    }
    await sample();
    // Drain finite certification incidents before the next profile so delayed
    // escalation from earlier traffic cannot bias the OFF/SHADOW/LIVE comparison.
    for (;;) {
      const active = await db.incident.findMany({
        where: {
          serviceId: { in: manifest.allServiceIds },
          createdAt: { gte: started },
          title: 'Automation capacity certification',
          status: { not: 'RESOLVED' },
        },
        select: { id: true },
        take: 8,
      });
      if (!active.length) break;
      await Promise.all(
        active.map(incident =>
          db.$transaction(tx =>
            applyIncidentLifecycleCommand(tx, {
              incidentId: incident.id,
              command: 'RESOLVE',
              source: 'SYSTEM',
            })
          )
        )
      );
    }
    const drainStarted = Date.now();
    const drainDeadline = Date.now() + Number(process.env.AUTOMATION_DRAIN_TIMEOUT_MS || 180000);
    let pending = 0;
    do {
      const jobs = await db.backgroundJob.count({
        where: {
          status: { in: ['PENDING', 'PROCESSING', 'PENDING_V2', 'PROCESSING_V2'] },
          scheduledAt: { lte: new Date() },
          NOT: { type: { in: ['ESCALATION', 'AUTO_UNSNOOZE'] } },
        },
      });
      const intents = await db.notification.count({
        where: { status: 'PENDING' },
      });
      pending = jobs + intents;
      if (!pending) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (Date.now() < drainDeadline);

    const telemetry = await collectSingleTelemetrySample({
      prisma: db,
      topology,
      stage: profile,
      baseUrl: process.env.BASE_URL || manifest.baseUrl,
      controlBaseUrl: process.env.LOAD_EMULATOR_CONTROL_URL,
      metricsToken: process.env.LOAD_METRICS_TOKEN,
      k8sNamespace: process.env.AUTOMATION_K8S_NAMESPACE,
    });
    const traces = await db.automationTrace.findMany({
      where: { serviceId: { in: manifest.allServiceIds }, evaluationAt: { gte: started } },
      select: { durationMs: true, fallbackReason: true, detail: true },
    });
    const durations = traces.map(trace => trace.durationMs).sort((a, b) => a - b);
    const incidents = await db.incident.count({
      where: {
        serviceId: { in: manifest.allServiceIds },
        createdAt: { gte: started },
        title: 'Automation capacity certification',
      },
    });
    const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8')) as {
      metrics: {
        iterations: { count: number };
        checks: { passes: number; fails: number };
        automation_accepted_events: { count: number };
        automation_ingestion_latency_ms: { 'p(95)': number; 'p(99)': number };
        dropped_iterations?: { count: number };
      };
    };
    if (incidents !== summary.metrics.automation_accepted_events.count)
      throw new Error(
        `Lost accepted event: ${incidents} incidents / ${summary.metrics.automation_accepted_events.count} accepted`
      );
    const duplicates = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*)::bigint AS count FROM (SELECT "serviceId", "dedupKey" FROM "Incident" WHERE "createdAt" >= ${started} AND title = 'Automation capacity certification' GROUP BY "serviceId", "dedupKey" HAVING COUNT(*) > 1) duplicate_groups`;
    if (Number(duplicates[0].count) !== 0) throw new Error('Duplicate incidents');
    const namespace = process.env.AUTOMATION_K8S_NAMESPACE;
    const { stdout: retryLogs } = await exec(
      namespace ? 'kubectl' : 'docker',
      namespace
        ? [
            'logs',
            '-n',
            namespace,
            '-l',
            'app.kubernetes.io/instance=automation',
            '--all-containers=true',
            '--max-log-requests=20',
            '--since-time=' + started.toISOString(),
            '--tail=-1',
          ]
        : [
            ...composeArgs,
            'logs',
            '--since',
            started.toISOString(),
            '--no-color',
            'web',
            'critical',
            'general',
            'scheduler',
          ],
      { maxBuffer: 100 * 1024 * 1024 }
    );
    const transactionRetryCount = (retryLogs.match(/db\.transaction\.retry/g) ?? []).length;
    const [notificationLatency] = await db.$queryRaw<
      Array<{ p95: number | null; p99: number | null; sent: bigint; failed: bigint }>
    >`
      SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("sentAt" - "createdAt")) * 1000) FILTER (WHERE "sentAt" IS NOT NULL) AS p95,
             percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("sentAt" - "createdAt")) * 1000) FILTER (WHERE "sentAt" IS NOT NULL) AS p99,
             COUNT(*) FILTER (WHERE "sentAt" IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
      FROM "Notification" WHERE "createdAt" >= ${started} AND "trafficClass" = 'CRITICAL'
    `;
    results.push({
      profile,
      acceptedEvents: incidents,
      duplicateGroups: 0,
      fallbackCount: traces.filter(trace => trace.fallbackReason).length,
      traceCount: traces.length,
      traceJsonBytes: traces.reduce(
        (bytes, trace) => bytes + Buffer.byteLength(JSON.stringify(trace.detail)),
        0
      ),
      pendingAfterDrain: pending,
      transactionRetryCount,
      recoveryDrainMs: Date.now() - drainStarted,
      criticalNotificationLatency: {
        p95Ms: notificationLatency.p95,
        p99Ms: notificationLatency.p99,
        sent: Number(notificationLatency.sent),
        failed: Number(notificationLatency.failed),
      },
      telemetrySamples: samples,
      traceRuntimeP99Ms: durations[Math.floor(durations.length * 0.99)] ?? null,
      summary,
      telemetry,
      deadlocksDelta: telemetry.postgres.deadlocks - Number(before.deadlocks),
    });
    process.stdout.write(`Certified ${topology} ${profile}: ${incidents} accepted incidents\n`);
  }
  const baseline = results[0];
  const comparisons = results.slice(1).map(result => ({
    profile: result.profile,
    acceptedRatio: result.acceptedEvents / Math.max(1, baseline.acceptedEvents),
    p95Ratio:
      result.summary.metrics.automation_ingestion_latency_ms['p(95)'] /
      baseline.summary.metrics.automation_ingestion_latency_ms['p(95)'],
    p99Ratio:
      result.summary.metrics.automation_ingestion_latency_ms['p(99)'] /
      baseline.summary.metrics.automation_ingestion_latency_ms['p(99)'],
    peakCriticalQueueAgeMs: Math.max(
      ...result.telemetrySamples.map(
        sample => sample.postgres.oldestPendingCriticalNotificationAgeMs
      )
    ),
    peakAutomationObservationQueueAgeMs: Math.max(
      ...result.telemetrySamples.map(
        sample => sample.postgres.oldestPendingAutomationObservationAgeMs
      )
    ),
    pendingAfterDrain: result.pendingAfterDrain,
    recoveryDrainMs: result.recoveryDrainMs,
    transactionRetryCount: result.transactionRetryCount,
    criticalNotificationLatency: result.criticalNotificationLatency,
    deadlocksDelta: result.deadlocksDelta,
  }));
  const limits = {
    latencyRatio: Number(process.env.AUTOMATION_MAX_LATENCY_RATIO || 1.25),
    queueAgeMs: Number(process.env.AUTOMATION_MAX_QUEUE_AGE_MS || 30000),
    notificationP99Ms: Number(process.env.AUTOMATION_MAX_NOTIFICATION_P99_MS || 30000),
  };
  const failures = results
    .flatMap(result => [
      ...(result.pendingAfterDrain > 0
        ? [`${result.profile}: queue did not drain (${result.pendingAfterDrain})`]
        : []),
      ...(result.deadlocksDelta > 0
        ? [`${result.profile}: ${result.deadlocksDelta} new deadlocks`]
        : []),
      ...(result.criticalNotificationLatency.failed > 0
        ? [`${result.profile}: failed critical notifications`]
        : []),
      ...((result.criticalNotificationLatency.p99Ms ?? 0) > limits.notificationP99Ms
        ? [`${result.profile}: critical notification p99 exceeds ${limits.notificationP99Ms}ms`]
        : []),
    ])
    .concat(
      comparisons.flatMap(result => [
        ...(result.p95Ratio > limits.latencyRatio || result.p99Ratio > limits.latencyRatio
          ? [`${result.profile}: HTTP latency exceeds ${limits.latencyRatio}x disabled`]
          : []),
        ...(result.peakCriticalQueueAgeMs > limits.queueAgeMs ||
        result.peakAutomationObservationQueueAgeMs > limits.queueAgeMs
          ? [`${result.profile}: queue age exceeds ${limits.queueAgeMs}ms`]
          : []),
      ])
    );
  await fs.writeFile(
    path.join(outputDir, 'certification.json'),
    JSON.stringify(
      {
        topology,
        generatedAt: new Date().toISOString(),
        rps: Number(process.env.AUTOMATION_RPS || 20),
        durationPerProfile: process.env.AUTOMATION_DURATION || '30s',
        comparisonGate: { passed: failures.length === 0, limits, failures },
        comparisons,
        results,
      },
      null,
      2
    ) + '\n'
  );
  if (failures.length) throw new Error(`Comparative gate failed: ${failures.join('; ')}`);
}
main()
  .catch(error => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
