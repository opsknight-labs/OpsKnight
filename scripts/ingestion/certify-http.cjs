/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS harness loads the shared TypeScript fixture runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Evidence paths belong to this local fixture and its private temporary directory. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const capacityStage = require('./capacity-stages.cjs').capacityStage(
  process.env.INGESTION_CAPACITY_STAGE
);
assert.ok(['full-stack', 'admission-only'].includes(capacityStage));
const admissionOnly = capacityStage === 'admission-only';
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prisma = require('../../src/lib/prisma').default;
const { consumeIngestionBatch } = require('../../src/lib/ingestion/worker');
const k6 = process.env.INGESTION_K6 || path.join(os.homedir(), '.local/bin/k6');
const directory = mkdtempSync(path.join(os.tmpdir(), 'ingestion-http-'));
const evidencePath =
  process.env.INGESTION_HTTP_EVIDENCE || 'plans/event-ingestion/local-http-load.json';
const summaryPath = evidencePath + '.k6-summary.json';
const ledgerPath = evidencePath + '.acknowledgments.jsonl';
const clientEvidence = () =>
  require('./client-evidence.cjs').readClientEvidence(summaryPath, ledgerPath);
let failure;
let fixtureServiceId;
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
let finishDatabaseProfile;
let finishBacklogSampler;
let evidenceWritten = false;
let stage = 'startup';
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(
    url.pathname,
    /^\/ingestion_test_http[_a-z0-9]*$/,
    'HTTP fixture requires its own dedicated database'
  );
  if (admissionOnly) {
    assert.match(
      process.env.INGESTION_DURATION || '60s',
      /^[1-9][0-9]?s$/,
      'Admission-only profiling is bounded to 99 seconds'
    );
    for (const flag of [
      process.env.INGESTION_HTTP_PROVIDER_CHECKS,
      process.env.INGESTION_HTTP_LIFECYCLE_CHECKS,
      process.env.INGESTION_HTTP_QUOTA_REPLAY_CHECKS,
      process.env.INGESTION_HTTP_REQUEST_GATE_CHECKS,
    ])
      assert.notEqual(flag, 'true', 'Provider/lifecycle checks require active consumers');
    assert.equal(
      Number(process.env.INGESTION_WARMUP_EVENTS || 0),
      0,
      'Consumer warmup is not admission-only work'
    );
  }
  const service = await prisma.service.create({ data: { name: `HTTP load ${runId}` } });
  fixtureServiceId = service.id;
  const integration = await prisma.integration.create({
    data: {
      serviceId: service.id,
      name: 'Isolated HTTP capacity fixture',
      type: 'EVENTS_API_V2',
      key: randomUUID(),
    },
  });
  const external = process.env.INGESTION_EXTERNAL_BASE_URL;
  const port = Number(process.env.INGESTION_PORT || 3210);
  const baseUrl = external || `http://127.0.0.1:${port}`;
  const candidateUrl = new URL(baseUrl);
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(candidateUrl.hostname) && candidateUrl.protocol === 'http:',
    'HTTP certification only targets a local isolated candidate'
  );
  if (external)
    assert.equal(process.env.INGESTION_EXTERNAL_CONSUMERS, admissionOnly ? 'false' : 'true');
  if (!external)
    server = spawn(process.execPath, ['.next/standalone/server.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        OPSKNIGHT_PROCESS_ROLE: admissionOnly ? 'http' : 'web',
        OPSKNIGHT_INGESTION_MODE: 'postgres',
        OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE: '10000000',
        NEXTAUTH_URL: baseUrl,
        NEXT_PUBLIC_APP_URL: baseUrl,
        REDIRECT_TO_CANONICAL_HOST: 'false',
        ALLOW_INSECURE_SECRETS: 'true',
        TRUST_PROXY_HEADERS: 'false',
      },
    });
  for (const stream of [server?.stdout, server?.stderr].filter(Boolean)) {
    stream.on('data', chunk => {
      serverOutput = (serverOutput + chunk.toString()).slice(-16000);
    });
  }
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server && server.exitCode !== null)
      throw new Error('Candidate HTTP server exited before readiness');
    try {
      const response = await fetch(`${baseUrl}/api/health?mode=readiness`, {
        signal: AbortSignal.timeout(2000),
      });
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
  stage = 'provider-checks';
  const providerChecks =
    process.env.INGESTION_HTTP_PROVIDER_CHECKS === 'true'
      ? await require('./provider-http-checks.cjs')({
          prisma,
          baseUrl,
          consumeIngestionBatch: external ? async () => 0 : consumeIngestionBatch,
        })
      : undefined;
  stage = 'lifecycle-checks';
  const lifecycleChecks =
    process.env.INGESTION_HTTP_LIFECYCLE_CHECKS === 'true'
      ? await require('./lifecycle-http-checks.cjs')({
          prisma,
          baseUrl,
          consumeIngestionBatch: external ? async () => 0 : consumeIngestionBatch,
        })
      : undefined;
  stage = 'quota-replay-checks';
  const quotaReplayChecks =
    process.env.INGESTION_HTTP_QUOTA_REPLAY_CHECKS === 'true'
      ? await require('./quota-replay-http-checks.cjs')({
          prisma,
          baseUrl,
          consumeIngestionBatch: external ? async () => 0 : consumeIngestionBatch,
        })
      : undefined;
  stage = 'request-gate-checks';
  const requestGateChecks =
    process.env.INGESTION_HTTP_REQUEST_GATE_CHECKS === 'true'
      ? await require('./request-gate-http-checks.cjs')({
          prisma,
          baseUrl,
          consumeIngestionBatch: external ? async () => 0 : consumeIngestionBatch,
        })
      : undefined;
  stage = 'warmup';
  const warmupEvents = Number(process.env.INGESTION_WARMUP_EVENTS || 0);
  assert.ok(Number.isInteger(warmupEvents) && warmupEvents >= 0 && warmupEvents <= 1000);
  const warmup = warmupEvents
    ? await require('./warmup-http.cjs')({
        prisma,
        baseUrl,
        events: warmupEvents,
        consumeIngestionBatch: external ? async () => 0 : consumeIngestionBatch,
      })
    : undefined;
  if (warmup && process.env.INGESTION_DOCKER_FULL_STACK === 'true') {
    warmup.downstreamDrain = await require('./downstream-drain.cjs')(prisma);
    assert.equal(
      warmup.downstreamDrain.passed,
      true,
      'Warmup effects must drain before measurement'
    );
  }
  if (process.env.INGESTION_DB_PROFILE === 'true')
    finishDatabaseProfile = await require('./database-profile.cjs')(prisma);
  // Execute real ingestion processing independently of request completion.
  if (!external && !admissionOnly)
    worker = (async () => {
      while (!draining) {
        const count = await consumeIngestionBatch(4);
        if (!count) await new Promise(resolve => setTimeout(resolve, 50));
      }
    })().catch(error => {
      workerFault = error;
      draining = true;
    });
  const candidate = external
    ? JSON.parse(process.env.INGESTION_CANDIDATE_METADATA || '{}')
    : {
        buildId: readFileSync('.next/BUILD_ID', 'utf8').trim(),
        sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
        sourceDirty: !!spawnSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).stdout.trim(),
      };
  if (process.env.INGESTION_BACKLOG_SAMPLES === 'true')
    finishBacklogSampler = await require('./backlog-sampler.cjs')(prisma, service.id);
  const started = performance.now();
  stage = 'measured-load';
  rmSync(summaryPath, { force: true });
  writeFileSync(ledgerPath, '', { mode: 0o600 });
  load = spawn(
    k6,
    [
      'run',
      '--quiet',
      '--log-format',
      'raw',
      '--console-output',
      ledgerPath,
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
  load.once('spawn', () => {
    if (process.connected)
      process.send?.({ type: 'ingestion-load-started', fixtureServiceId: service.id }, () => {});
  });
  const loadExit = await new Promise((resolve, reject) => {
    load.once('error', reject);
    load.once('exit', resolve);
  });
  if (process.connected) process.send?.({ type: 'ingestion-load-stopped' }, () => {});
  const ingressMs = performance.now() - started;
  const backlogDuringLoad = finishBacklogSampler ? await finishBacklogSampler() : undefined;
  finishBacklogSampler = undefined;
  const [atAdmissionEnd] = await prisma.$queryRaw`
    SELECT COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE "status" NOT IN ('COMPLETED', 'ARCHIVED'))::int AS pending,
      COALESCE(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - MIN("acceptedAt")
        FILTER (WHERE "status" NOT IN ('COMPLETED', 'ARCHIVED'))) * 1000, 0)::double precision AS "oldestPendingAgeMs"
    FROM "IngestionReceipt" WHERE "serviceId" = ${service.id}
  `;
  stage = 'admission-quiescence';
  const admissionQuiescence = await require('./quiesce-admission.cjs')();
  if (admissionOnly) {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const acknowledged = summary.metrics.ingestion_durable_accepted?.count || 0;
    const where = { serviceId: service.id };
    const [accepted, pending, claimed, incidents, alerts] = await Promise.all([
      prisma.ingestionReceipt.count({ where }),
      prisma.ingestionReceipt.count({ where: { ...where, status: 'PENDING' } }),
      prisma.ingestionReceipt.count({ where: { ...where, attempts: { gt: 0 } } }),
      prisma.incident.count({ where }),
      prisma.alert.count({ where }),
    ]);
    const databaseProfile = finishDatabaseProfile ? await finishDatabaseProfile() : undefined;
    finishDatabaseProfile = undefined;
    const reconciled =
      accepted > 0 &&
      accepted === acknowledged &&
      pending === accepted &&
      claimed === 0 &&
      incidents === 0 &&
      alerts === 0;
    const result = {
      measuredAt: new Date().toISOString(),
      capacityStage,
      candidate,
      runtime: process.version,
      scope:
        'Bounded native HTTP authentication, quota and durable append with HTTP-only replicas and no consumers. Pending receipts are intentionally retained under normal hard budgets. Not incident/effect processing or sustained capacity certification.',
      fixtureServiceId: service.id,
      targetRps: Number(process.env.INGESTION_TARGET_RPS || 1000),
      duration: process.env.INGESTION_DURATION || '60s',
      accepted,
      clientEvidence: clientEvidence(),
      acknowledged,
      pending,
      claimed,
      incidents,
      alerts,
      ambiguousSubmissions: accepted - acknowledged,
      receiptDrainPerformed: false,
      admissionQuiescence,
      backlogDuringLoad,
      databaseProfile,
      ingressMs,
      acceptedPerSecond: (accepted * 1000) / ingressMs,
      metrics: summary.metrics,
      loadExit,
      reconciled,
      passed: loadExit === 0 && reconciled && (!backlogDuringLoad || backlogDuringLoad.passed),
      certifiedEnterprise: false,
    };
    writeFileSync(
      process.env.INGESTION_HTTP_EVIDENCE || 'plans/event-ingestion/local-http-load.json',
      JSON.stringify(result, null, 2) + '\n'
    );
    evidenceWritten = true;
    assert.ok(result.passed, 'Admission-only HTTP thresholds or ledger reconciliation failed');
    return;
  }
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
    if (external || !(await consumeIngestionBatch(8)))
      await new Promise(resolve => setTimeout(resolve, 100));
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
  const [endToEndLatency] = await prisma.$queryRaw`
    SELECT MAX(EXTRACT(EPOCH FROM ("completedAt" - COALESCE("receivedAt", "acceptedAt"))) * 1000)::double precision AS "maxMs",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - COALESCE("receivedAt", "acceptedAt"))) * 1000)::double precision AS "p50Ms",
      percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - COALESCE("receivedAt", "acceptedAt"))) * 1000)::double precision AS "p95Ms",
      percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - COALESCE("receivedAt", "acceptedAt"))) * 1000)::double precision AS "p99Ms"
    FROM "IngestionReceipt" WHERE "serviceId" = ${service.id} AND "status" = 'COMPLETED'
  `;
  const completionLatencyLimitMs = Number(process.env.INGESTION_COMPLETION_P95_MS || 2000);
  const completionLatencyPassed =
    accepted > 0 &&
    endToEndLatency.p95Ms !== null &&
    endToEndLatency.p95Ms <= completionLatencyLimitMs;
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
  // Receipt completion is atomic with durable outbox persistence, not with
  // delivery. Report unfinished fixture effects separately from receipt drain.
  const sideEffectJobs = await prisma.$queryRaw`
    SELECT job.status::text AS status, COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE job.status IN ('PENDING'::"JobStatus", 'PENDING_V2'::"JobStatus")
        AND job."scheduledAt" <= CURRENT_TIMESTAMP)::int AS due,
      COALESCE(MAX(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - job."scheduledAt")) * 1000)
        FILTER (WHERE job.status IN ('PENDING'::"JobStatus", 'PENDING_V2'::"JobStatus")
          AND job."scheduledAt" <= CURRENT_TIMESTAMP), 0)::double precision AS "oldestDueAgeMs"
    FROM "BackgroundJob" job
    JOIN "Incident" incident ON incident.id = job.payload->>'incidentId'
    WHERE job.type = 'SCHEDULED_TASK'::"JobType" AND job.payload->>'task' = 'EVENT_SIDE_EFFECT'
      AND incident."serviceId" = ${service.id}
    GROUP BY job.status ORDER BY job.status
  `;
  const databaseProfile = finishDatabaseProfile ? await finishDatabaseProfile() : undefined;
  finishDatabaseProfile = undefined;
  const evidence = {
    measuredAt: new Date().toISOString(),
    capacityStage,
    candidate,
    runtime: process.version,
    scope: external
      ? 'Local Docker gateway and image ingestion consumers sharing an isolated PostgreSQL container network; not enterprise HA certification'
      : 'Local production HTTP gateway plus independent incident consumer and isolated PostgreSQL; not HA topology certification',
    providerChecks,
    lifecycleChecks,
    quotaReplayChecks,
    requestGateChecks,
    warmup,
    databaseProfile,
    fixtureServiceId: service.id,
    atAdmissionEnd,
    backlogDuringLoad,
    admissionQuiescence,
    endToEndLatency,
    completionLatencyLimitMs,
    completionLatencyPassed,
    admissionThresholdsPassed: loadExit === 0,
    targetRps: Number(process.env.INGESTION_TARGET_RPS || 1000),
    workload: process.env.INGESTION_WORKLOAD || 'many-key',
    payloadBytes: Number(process.env.INGESTION_PAYLOAD_BYTES || 10000),
    payloadPattern: process.env.INGESTION_PAYLOAD_PATTERN || 'random',
    duration: process.env.INGESTION_DURATION || '60s',
    loadExit,
    clientEvidence: clientEvidence(),
    acknowledged,
    accepted,
    completed,
    alerts,
    incidents,
    pending,
    ambiguousSubmissions,
    sideEffectJobs: {
      scope:
        'Measured fixture incident outbox jobs after receipt drain; excludes preflight, other job families and external-provider completion. Not a downstream drain certification.',
      statuses: sideEffectJobs,
    },
    oldestPendingAgeMs: oldest ? Date.now() - oldest.acceptedAt.getTime() : 0,
    ingressMs,
    completedMs,
    acceptedPerSecond: (accepted * 1000) / ingressMs,
    completedPerSecondIncludingDrain: (completed * 1000) / completedMs,
    reconciled,
    metrics: summary.metrics,
    passed:
      loadExit === 0 &&
      reconciled &&
      ambiguousSubmissions === 0 &&
      completionLatencyPassed &&
      (!backlogDuringLoad || backlogDuringLoad.passed),
    certifiedEnterprise: false,
  };
  writeFileSync(
    process.env.INGESTION_HTTP_EVIDENCE || 'plans/event-ingestion/local-http-load.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
  evidenceWritten = true;
  if (backlogDuringLoad)
    assert.ok(backlogDuringLoad.passed, 'Backlog sampling failed or truncated');
  assert.ok(reconciled, 'Accepted ledger failed end-to-end drain reconciliation');
  assert.equal(ambiguousSubmissions, 0, 'HTTP acknowledgements and durable receipts differ');
  assert.equal(loadExit, 0, 'Candidate failed the configured HTTP admission thresholds');
  assert.ok(completionLatencyPassed, 'Candidate failed end-to-end processing latency threshold');
}
main()
  .catch(error => {
    failure = error;
    console.error(error);
    if (!evidenceWritten) {
      writeFileSync(
        process.env.INGESTION_HTTP_EVIDENCE || 'plans/event-ingestion/local-http-load.json',
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            candidate: JSON.parse(process.env.INGESTION_CANDIDATE_METADATA || '{}'),
            passed: false,
            certifiedEnterprise: false,
            clientEvidence: clientEvidence(),
            fixtureServiceId,
            failureStage: stage,
            errorType: error.name,
            scope: 'Failed before full load evidence was produced; local stderr has diagnostics',
          },
          null,
          2
        ) + '\n'
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    draining = true;
    if (finishBacklogSampler) await finishBacklogSampler().catch(() => {});
    if (finishDatabaseProfile) await finishDatabaseProfile().catch(() => {});
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
    if (failure && !evidenceWritten) {
      writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            candidate: JSON.parse(process.env.INGESTION_CANDIDATE_METADATA || '{}'),
            passed: false,
            certifiedEnterprise: false,
            fixtureServiceId,
            failureStage: stage,
            errorType: failure.name,
            clientEvidence: clientEvidence(),
            scope:
              'Incomplete failed run; client artifacts retained after load shutdown, database reconciliation required.',
          },
          null,
          2
        ) + '\n'
      );
    }
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });
