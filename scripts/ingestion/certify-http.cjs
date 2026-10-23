require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prisma = require('../../src/lib/prisma').default;
const { consumeIngestionBatch } = require('../../src/lib/ingestion/worker');
const k6 = process.env.INGESTION_K6 || path.join(os.homedir(), '.local/bin/k6');
const directory = mkdtempSync(path.join(os.tmpdir(), 'ingestion-http-'));
const summaryPath = path.join(directory, 'summary.json');
const runId = randomUUID();
// Ephemeral fixture key; never a deployment credential.
process.env.ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
let load;
let server;
let serverOutput = '';
let readinessStatus;
let draining = false;
let worker;
let workerFault;
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(
    url.pathname,
    '/ingestion_test_http',
    'HTTP fixture requires its own dedicated database'
  );
  const service = await prisma.service.create({ data: { name: `HTTP load ${runId}` } });
  const integration = await prisma.integration.create({
    data: {
      serviceId: service.id,
      name: 'Isolated HTTP capacity fixture',
      type: 'EVENTS_API_V2',
      key: randomUUID(),
    },
  });
  const port = Number(process.env.INGESTION_PORT || 3210);
  const baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['.next/standalone/server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      OPSKNIGHT_PROCESS_ROLE: 'web',
      OPSKNIGHT_INGESTION_MODE: 'postgres',
      OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE: '10000000',
      NEXTAUTH_URL: baseUrl,
      NEXT_PUBLIC_APP_URL: baseUrl,
      REDIRECT_TO_CANONICAL_HOST: 'false',
      ALLOW_INSECURE_SECRETS: 'true',
      TRUST_PROXY_HEADERS: 'false',
    },
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => {
      serverOutput = (serverOutput + chunk.toString()).slice(-16000);
    });
  }
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Candidate HTTP server exited before readiness');
    try {
      const response = await fetch(`${baseUrl}/api/health?mode=readiness`);
      readinessStatus = `${response.status}: ${(await response.text()).slice(0, 2000)}`;
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* still starting */
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, `Candidate server readiness failed: ${readinessStatus}\n${serverOutput}`);
  const providerChecks =
    process.env.INGESTION_HTTP_PROVIDER_CHECKS === 'true'
      ? await require('./provider-http-checks.cjs')({ prisma, baseUrl, consumeIngestionBatch })
      : undefined;
  // Execute real ingestion processing independently of request completion.
  worker = (async () => {
    while (!draining) {
      const count = await consumeIngestionBatch(4);
      if (!count) await new Promise(resolve => setTimeout(resolve, 50));
    }
  })().catch(error => {
    workerFault = error;
    draining = true;
  });
  const candidate = { buildId: readFileSync('.next/BUILD_ID', 'utf8').trim(),
    sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    sourceDirty: !!spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim(),
  };
  const started = performance.now();
  load = spawn(
    k6,
    [
      'run',
      '--quiet',
      '--summary-export',
      summaryPath,
      'tests/load/scenarios/durable-ingestion.js',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        INGESTION_RUN_ID: runId,
        INGESTION_BASE_URL: baseUrl,
        INGESTION_ROUTING_KEY: integration.key,
      },
    }
  );
  const loadExit = await new Promise((resolve, reject) => {
    load.once('error', reject);
    load.once('exit', resolve);
  });
  const ingressMs = performance.now() - started;
  draining = true;
  await worker;
  if (workerFault) throw workerFault;
  const drainDeadline = Date.now() + Number(process.env.INGESTION_DRAIN_TIMEOUT_MS || 300000);
  while (Date.now() < drainDeadline) {
    const remaining = await prisma.ingestionReceipt.count({
      where: {
        serviceId: service.id,
        status: { notIn: ['COMPLETED', 'ARCHIVED'] },
      },
    });
    if (!remaining) break;
    if (!(await consumeIngestionBatch(8))) await new Promise(resolve => setTimeout(resolve, 100));
  }
  const completedMs = performance.now() - started;
  const [accepted, completed, alerts, incidents, pending, oldest] = await Promise.all([
    prisma.ingestionReceipt.count({ where: { serviceId: service.id } }),
    prisma.ingestionReceipt.count({ where: { serviceId: service.id, status: 'COMPLETED' } }),
    prisma.alert.count({ where: { serviceId: service.id } }),
    prisma.incident.count({ where: { serviceId: service.id } }),
    prisma.ingestionReceipt.count({
      where: { serviceId: service.id, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
    }),
    prisma.ingestionReceipt.findFirst({
      where: { serviceId: service.id, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
      orderBy: { acceptedAt: 'asc' },
      select: { acceptedAt: true },
    }),
  ]);
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const acknowledged = summary.metrics.ingestion_durable_accepted?.count || 0;
  const expectedIncidents =
    process.env.INGESTION_WORKLOAD === 'hot-key' ? (accepted ? 1 : 0) : accepted;
  const reconciled =
    pending === 0 &&
    completed === accepted &&
    alerts === accepted &&
    incidents === expectedIncidents;
  const ambiguousSubmissions = accepted - acknowledged;
  const evidence = {
    measuredAt: new Date().toISOString(),
    candidate,
    runtime: process.version,
    scope:
      'Local production HTTP gateway plus independent incident consumer and isolated PostgreSQL; not HA topology certification',
    providerChecks,
    targetRps: Number(process.env.INGESTION_TARGET_RPS || 1000),
    workload: process.env.INGESTION_WORKLOAD || 'many-key',
    duration: process.env.INGESTION_DURATION || '60s',
    loadExit,
    acknowledged,
    accepted,
    completed,
    alerts,
    incidents,
    pending,
    ambiguousSubmissions,
    oldestPendingAgeMs: oldest ? Date.now() - oldest.acceptedAt.getTime() : 0,
    ingressMs,
    completedMs,
    acceptedPerSecond: (accepted * 1000) / ingressMs,
    completedPerSecondIncludingDrain: (completed * 1000) / completedMs,
    reconciled,
    metrics: summary.metrics,
    passed: loadExit === 0 && reconciled && ambiguousSubmissions === 0,
    certifiedEnterprise: false,
  };
  writeFileSync(
    process.env.INGESTION_HTTP_EVIDENCE || 'plans/event-ingestion/local-http-load.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
  assert.ok(reconciled, 'Accepted ledger failed end-to-end drain reconciliation');
  assert.equal(ambiguousSubmissions, 0, 'HTTP acknowledgements and durable receipts differ');
  assert.equal(loadExit, 0, 'Candidate failed the configured HTTP capacity thresholds');
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    draining = true;
    await worker?.catch(() => {});
    for (const child of [load, server]) {
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise(resolve => {
          child.once('exit', resolve);
          child.kill('SIGTERM');
          const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
          timer.unref();
          child.once('exit', () => clearTimeout(timer));
        });
      }
    }
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });
