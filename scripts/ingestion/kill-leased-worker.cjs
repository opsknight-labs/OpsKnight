const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  lockEventDedupKeys,
  normalizeDedupKeys,
} = require('../../src/lib/incidents/event-identity');

// Prove that the terminated process owns an actual processing transaction:
// its PostgreSQL backend must be waiting on this fixture's deduplication lock.
module.exports = async function killLeasedWorker({
  prisma,
  baseUrl,
  workers,
  inspect,
  invoke,
  network,
  loadActive,
}) {
  const run = randomUUID();
  const service = await prisma.service.create({ data: { name: `Leased worker crash ${run}` } });
  const key = randomUUID();
  const integration = await prisma.integration.create({
    data: {
      serviceId: service.id,
      name: 'Owned crash fixture',
      type: 'EVENTS_API_V2',
      // Events API routing keys use exact database lookup, matching the existing API contract.
      key,
    },
  });
  const payload = {
    summary: 'Worker crash fixture',
    source: 'owned-crash-fixture',
    severity: 'critical',
  };
  const identity = normalizeDedupKeys(run, integration.id, payload);
  const addresses = new Map();
  for (const name of workers) {
    const container = await inspect(name);
    addresses.set(container.NetworkSettings.Networks[network].IPAddress, name);
  }
  let release = () => {};
  let locked = () => {};
  let holder;
  const ready = new Promise(resolve => {
    locked = resolve;
  });
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const held = prisma.$transaction(
    async tx => {
      [holder] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
      await lockEventDedupKeys(tx, service.id, [identity.primary, identity.legacy].filter(Boolean));
      locked();
      await gate;
    },
    { timeout: 15000, maxWait: 2000 }
  );
  let receiptId;
  let result;
  try {
    await Promise.race([
      ready,
      held.then(() => {
        throw new Error('Crash fixture lock ended early');
      }),
    ]);
    assert.ok(loadActive(), 'HTTP load ended before crash fixture admission');
    const response = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Token token=${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': run,
      },
      body: JSON.stringify({ event_action: 'trigger', dedup_key: run, payload }),
    });
    assert.equal(response.status, 202, 'Crash fixture was not durably accepted');
    receiptId = (await response.json()).data?.result?.receiptId;
    assert.equal(typeof receiptId, 'string');
    const deadline = Date.now() + 5000;
    let owner;
    while (Date.now() < deadline && !owner) {
      const waiting = await prisma.$queryRaw`
        SELECT host(client_addr) AS address FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'advisory'
          AND ${holder.pid} = ANY(pg_blocking_pids(pid))
      `;
      owner = waiting.map(row => addresses.get(row.address)).find(Boolean);
      if (!owner) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(owner, 'No owned image worker entered the fixture processing transaction');
    const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    assert.equal(receipt.status, 'PROCESSING');
    assert.ok(receipt.leaseToken && receipt.leaseExpiresAt);
    assert.equal(await prisma.incident.count({ where: { serviceId: service.id } }), 0);
    assert.ok(loadActive(), 'HTTP load ended before leased-worker termination');
    const killedAt = Date.now();
    await invoke(['kill', '--signal', 'KILL', owner]);
    result = {
      action: 'SIGKILL',
      target: owner,
      at: new Date(killedAt).toISOString(),
      receiptId,
      priorLeaseExpiresAt: receipt.leaseExpiresAt.toISOString(),
      processingTransactionProven: true,
      loadActive: true,
      leaseExpiryAdvanced: false,
    };
  } finally {
    release();
    await held;
  }
  const deadline = Date.now() + 330000;
  let receipt;
  while (Date.now() < deadline) {
    receipt = await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    if (receipt.status === 'COMPLETED') break;
    assert.notEqual(receipt.status, 'DEAD', 'Crash fixture dead-lettered');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(receipt.status, 'COMPLETED', 'Natural lease recovery did not complete');
  assert.equal(await prisma.incident.count({ where: { serviceId: service.id } }), 1);
  assert.equal(await prisma.alert.count({ where: { serviceId: service.id } }), 1);
  return {
    ...result,
    recoveredAt: receipt.completedAt.toISOString(),
    recoveryMs: receipt.completedAt.getTime() - Date.parse(result.at),
    attempts: receipt.attempts,
    completed: 1,
    alerts: 1,
    incidents: 1,
  };
};
