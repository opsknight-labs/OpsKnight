require('./isolated-runtime.cjs');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const { processEvent } = require('../../src/lib/events');
const { acceptPostgresEvent } = require('../../src/lib/ingestion/postgres');
const { consumeIngestionBatch } = require('../../src/lib/ingestion/worker');
const count = Number(process.env.INGESTION_BENCHMARK_EVENTS || 200);
if (!Number.isInteger(count) || count < 1 || count > 10000)
  throw new Error('Invalid benchmark size');
const concurrency = 4;
async function parallel(operation) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < count) {
        const index = cursor++;
        await operation(index);
      }
    })
  );
}
function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)] || 0;
}
function latencies(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}
async function workload(mode, hot) {
  const service = await prisma.service.create({
    data: { name: `Ingestion benchmark ${randomUUID()}` },
  });
  const timings = [];
  const started = performance.now();
  await parallel(async index => {
    const event = {
      event_action: 'trigger',
      dedup_key: hot ? 'hot' : `key-${index}`,
      payload: {
        summary: 'Benchmark alert',
        source: 'fixture',
        severity: 'critical',
        custom_details: { body: 'x'.repeat(10000) },
      },
    };
    const envelope = {
      event,
      serviceId: service.id,
      integrationId: 'benchmark',
      integrationType: 'WEBHOOK',
      providerPayload: {},
      receivedAt: new Date(),
    };
    const begin = performance.now();
    if (mode === 'sync') await processEvent(event, service.id, 'benchmark', envelope);
    else await acceptPostgresEvent(envelope, `delivery-${index}`);
    timings.push(performance.now() - begin);
  });
  const acceptanceMs = performance.now() - started;
  if (mode === 'postgres') {
    while (await consumeIngestionBatch(concurrency)) {
      /* bounded drain after ingress stops */
    }
  }
  const totalMs = performance.now() - started;
  const [alerts, incidents, receipts, pending, budget] = await Promise.all([
    prisma.alert.count({ where: { serviceId: service.id } }),
    prisma.incident.count({ where: { serviceId: service.id } }),
    prisma.ingestionReceipt.count({ where: { serviceId: service.id, status: 'COMPLETED' } }),
    prisma.ingestionReceipt.count({
      where: { serviceId: service.id, status: { not: 'COMPLETED' } },
    }),
    prisma.ingestionBudget.aggregate({ _sum: { pending: true } }),
  ]);
  const correct =
    alerts === count &&
    incidents === (hot ? 1 : count) &&
    !pending &&
    (mode === 'sync' || receipts === count);
  if (!correct) throw new Error('Benchmark reconciliation failed');
  return {
    mode,
    keys: hot ? 'same-key' : 'many-key',
    events: count,
    concurrency,
    acknowledgementRps: (count * 1000) / acceptanceMs,
    drainedCompletionRps: (count * 1000) / totalMs,
    acceptanceMs,
    totalMs,
    acknowledgementLatencyMs: latencies(timings),
    alerts,
    incidents,
    completedReceipts: receipts,
    pending,
    globalPending: budget._sum.pending,
    reconciled: correct,
  };
}
(async () => {
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: false },
    update: { automationEnabled: false },
  });
  while (await consumeIngestionBatch(concurrency)) {
    /* drain earlier isolated fixtures */
  }
  const results = [];
  for (const [mode, hot] of [
    ['sync', false],
    ['postgres', false],
    ['postgres', true],
  ]) {
    results.push(await workload(mode, hot));
  }
  const evidence = {
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    scope:
      'Local PostgreSQL library microbenchmark; excludes HTTP authentication, quotas, deployment networking and external delivery',
    certified: false,
    automationEnabled: false,
    results,
  };
  const json = JSON.stringify(evidence, null, 2) + '\n';
  if (process.argv[2]) writeFileSync(process.argv[2], json);
  process.stdout.write(json);
})()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
