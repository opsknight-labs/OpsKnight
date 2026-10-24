/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture shares the production database runtime. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function requestGateHttpChecks({ prisma, baseUrl, consumeIngestionBatch }) {
  const database = new URL(process.env.DATABASE_URL);
  const target = new URL(baseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
  assert.equal(database.port, '55445');
  assert.match(database.pathname, /^\/ingestion_test_http[_a-z0-9]*$/);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
  assert.equal(target.protocol, 'http:');
  const replicas = Number(process.env.INGESTION_WEB_REPLICAS || 2);
  const slots = Number(process.env.INGESTION_CANDIDATE_REQUEST_SLOTS || 32);
  assert.ok(Number.isInteger(replicas) && replicas >= 1 && replicas <= 4);
  assert.ok(Number.isInteger(slots) && slots >= 1 && slots <= 64);
  const marker = randomUUID();
  const service = await prisma.service.create({ data: { name: `Owned native gate ${marker}` } });
  const integration = await prisma.integration.create({
    data: {
      serviceId: service.id,
      name: 'Owned gate recovery',
      type: 'EVENTS_API_V2',
      key: randomUUID(),
    },
  });
  const quotaKey = `integration:${integration.id}:events`;
  await prisma.$executeRaw`INSERT INTO "IngestionQuota"
    ("key", tokens, rate, burst, "updatedAt", "lastAllowed", "policyRevision")
    VALUES (${quotaKey}, 10000000, 10000000, 10000000, statement_timestamp(), true, 0)`;
  let release;
  let locked;
  const lockAcquired = new Promise(resolve => {
    locked = resolve;
  });
  const unlock = new Promise(resolve => {
    release = resolve;
  });
  const lockTask = prisma.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT "key" FROM "IngestionQuota" WHERE "key" = ${quotaKey} FOR UPDATE`;
      locked();
      await unlock;
    },
    { timeout: 10000 }
  );
  // A failed lock must not leave the fixture waiting for a signal forever.
  await Promise.race([
    lockAcquired,
    lockTask.then(() => {
      throw new Error('Fixture lock exited');
    }),
  ]);
  const started = Date.now();
  const send = async index => {
    const response = await fetch(new URL('/api/events', target), {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token token=${integration.key}`,
        'Idempotency-Key': `gate-recovered:${marker}:${index}`,
      },
      body: JSON.stringify({
        event_action: 'trigger',
        dedup_key: `${marker}:${index}`,
        payload: {
          summary: 'Owned native gate recovery',
          source: 'request-gate',
          severity: 'warning',
        },
      }),
    });
    const body = await response.json();
    return { status: response.status, receiptId: body.data?.result?.receiptId };
  };
  const pending = Array.from({ length: replicas * slots }, (_, index) =>
    send(index).catch(() => ({ status: 0 }))
  );
  let overloaded = false;
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const probe = await fetch(new URL('/api/events', target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(1000),
      });
      await probe.arrayBuffer();
      if (probe.status === 503) {
        overloaded = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally {
    release();
    await lockTask;
  }
  const results = await Promise.all(pending);
  assert.ok(
    overloaded,
    'Held authenticated quota requests did not saturate the native shared gate'
  );
  assert.ok(
    results.every(result => [202, 503].includes(result.status)),
    'Held requests must finish with accepted receipts or explicit overload'
  );
  const accepted = results.filter(result => result.status === 202);
  assert.ok(accepted.length > 0);
  assert.ok(accepted.every(result => typeof result.receiptId === 'string'));
  const recovered = await send('after-release');
  assert.equal(
    recovered.status,
    202,
    'Normal admission did not recover after the quota lock released'
  );
  accepted.push(recovered);
  const completionDeadline = Date.now() + 30000;
  let completed;
  do {
    await consumeIngestionBatch(4);
    completed = await prisma.ingestionReceipt.count({
      where: { serviceId: service.id, status: 'COMPLETED' },
    });
    if (completed === accepted.length) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < completionDeadline);
  assert.equal(completed, accepted.length);
  assert.equal(
    await prisma.ingestionReceipt.count({ where: { serviceId: service.id } }),
    accepted.length
  );
  assert.equal(await prisma.alert.count({ where: { serviceId: service.id } }), accepted.length);
  assert.equal(await prisma.incident.count({ where: { serviceId: service.id } }), accepted.length);
  return {
    passed: true,
    heldRequests: results.length,
    overloadObserved: true,
    acceptedAndCompleted: accepted.length,
    ambiguousSubmissions: 0,
    recoveryAccepted: true,
    elapsedMs: Date.now() - started,
    scope:
      'Real complete HTTP requests held on an owned quota-row lock, then released and reconciled. Next middleware buffers partial bodies before route handlers; this does not certify a network body deadline.',
  };
};
