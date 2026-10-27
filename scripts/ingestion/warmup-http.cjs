const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function warmupHttp({ prisma, baseUrl, consumeIngestionBatch, events }) {
  assert.ok(Number.isInteger(events) && events >= 1 && events <= 1000);
  const started = performance.now();
  const run = randomUUID();
  const service = await prisma.service.create({ data: { name: `HTTP warmup ${run}` } });
  const integration = await prisma.integration.create({
    data: {
      name: 'Isolated warmup fixture',
      type: 'EVENTS_API_V2',
      serviceId: service.id,
      key: randomUUID(),
    },
  });
  for (let index = 0; index < events; index++) {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Token token=${integration.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${run}:${index}`,
      },
      body: JSON.stringify({
        event_action: 'trigger',
        dedup_key: `${run}:${index}`,
        payload: { summary: 'HTTP warmup fixture', source: 'http-warmup', severity: 'critical' },
      }),
    });
    const result = await response.json();
    assert.equal(response.status, 202, 'Warmup admission failed');
    assert.equal(typeof result.data?.result?.receiptId, 'string');
    await consumeIngestionBatch(4);
  }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await consumeIngestionBatch(4);
    if (
      !(await prisma.ingestionReceipt.count({
        where: { serviceId: service.id, status: { not: 'COMPLETED' } },
      }))
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const completed = await prisma.ingestionReceipt.count({
    where: { serviceId: service.id, status: 'COMPLETED' },
  });
  assert.equal(completed, events);
  assert.equal(await prisma.alert.count({ where: { serviceId: service.id } }), events);
  assert.equal(await prisma.incident.count({ where: { serviceId: service.id } }), events);
  return {
    events,
    completed,
    durationMs: performance.now() - started,
    scope:
      'Separate reconciled warmup fixture; excluded from measured load counts and database profile',
  };
};
