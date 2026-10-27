/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture reuses the production policy service. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { getIngestionPolicy } = require('../../src/lib/ingestion/policy');
const { applyIngestionCommand } = require('../../src/lib/ingestion/operations');

module.exports = async function quotaReplayHttpChecks({ prisma, baseUrl, consumeIngestionBatch }) {
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
  assert.equal(database.port, '55445');
  assert.match(database.pathname, /^\/ingestion_test_http[_a-z0-9]*$/);
  const target = new URL(baseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(target.protocol, 'http:');
  const run = randomUUID();
  const previous = await getIngestionPolicy();
  assert.equal(previous.paused, false, 'Quota replay preflight requires admission running');
  const actor = await prisma.user.create({
    data: {
      name: 'Owned quota replay certifier',
      email: `ingestion-replay-${run}@example.test`,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  const evidence = [];
  const fixtures = [
    {
      type: 'EVENTS_API_V2',
      path: '/api/events',
      header: 'Authorization',
      payload: {
        event_action: 'trigger',
        dedup_key: run,
        payload: {
          summary: 'Owned lost-response replay',
          source: 'quota-replay',
          severity: 'warning',
        },
      },
      count: 1,
    },
    {
      type: 'WEBHOOK',
      path: '/api/integrations/webhook',
      header: 'x-integration-key',
      payload: {
        status: 'triggered',
        dedup_key: run,
        summary: 'Owned webhook replay',
        source: 'quota-replay',
        severity: 'warning',
      },
      count: 1,
    },
    {
      type: 'PAGERDUTY',
      path: '/api/integrations/pagerduty',
      header: 'x-routing-key',
      payload: {
        event_action: 'trigger',
        dedup_key: run,
        payload: { summary: 'Owned PagerDuty replay', source: 'quota-replay', severity: 'warning' },
      },
      count: 1,
    },
    {
      type: 'PROMETHEUS',
      path: '/api/integrations/prometheus',
      header: 'x-integration-key',
      payload: {
        version: '4',
        groupKey: run,
        status: 'firing',
        receiver: 'opsknight',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        externalURL: '',
        alerts: [0, 1].map(index => ({
          status: 'firing',
          labels: { alertname: `quota-replay-${index}` },
          annotations: { summary: `Owned batch replay ${index}` },
          generatorURL: '',
          startsAt: '2026-10-23T00:00:00Z',
          fingerprint: `${run}-${index}`,
        })),
      },
      count: 2,
    },
  ];
  const ids = body =>
    body.data?.results?.map(result => result.receiptId) || [
      body.data?.result?.receiptId || body.receiptId,
    ];
  try {
    await applyIngestionCommand(
      {
        action: 'configure',
        expectedRevision: previous.revision,
        policy: {
          ...previous.policy,
          quotas: {
            eventsPerMinute: 1,
            eventsBurst: 1,
            integrationPerMinute: 1,
            integrationBurst: 1,
          },
        },
      },
      actor.id
    );
    for (const fixture of fixtures) {
      const service = await prisma.service.create({
        data: { name: `Owned ${fixture.type} replay ${run}` },
      });
      const integration = await prisma.integration.create({
        data: {
          serviceId: service.id,
          name: 'Owned quota replay',
          type: fixture.type,
          key: randomUUID(),
        },
      });
      const delivery = randomUUID();
      const url = `${baseUrl}${fixture.path}${fixture.path === '/api/events' ? '' : `?integrationId=${integration.id}`}`;
      const post = (key = delivery, payload = fixture.payload, credential = integration.key) =>
        fetch(url, {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
          headers: {
            [fixture.header]:
              fixture.header === 'Authorization' ? `Token token=${credential}` : credential,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify(payload),
        });
      const original = await post();
      assert.equal(original.status, 202, `${fixture.type} initial acceptance failed`);
      const originalIds = ids(await original.json());
      assert.equal(originalIds.length, fixture.count);
      assert.ok(originalIds.every(id => typeof id === 'string'));
      // Treat the initial acknowledgement as lost and retry concurrently through the gateway.
      for (const response of await Promise.all(Array.from({ length: 12 }, () => post()))) {
        assert.equal(
          response.status,
          202,
          `${fixture.type} quota prevented accepted receipt recovery`
        );
        assert.deepEqual(ids(await response.json()), originalIds);
      }
      assert.equal(
        (await post(randomUUID())).status,
        429,
        'Unknown identity bypassed new-event quota'
      );
      assert.ok(
        [400, 401, 403].includes(
          (await post(delivery, fixture.payload, 'invalid-fixture-key')).status
        )
      );
      const changed = structuredClone(fixture.payload);
      if (changed.payload) changed.payload.summary = 'Changed retained content';
      else if (changed.commonAnnotations)
        changed.commonAnnotations.summary = 'Changed retained content';
      else changed.summary = 'Changed retained content';
      assert.equal(
        (await post(delivery, changed)).status,
        409,
        'Changed content reused old delivery identity'
      );
      const deadline = Date.now() + 60000;
      let completed = 0;
      while (Date.now() < deadline) {
        await consumeIngestionBatch(4);
        completed = await prisma.ingestionReceipt.count({
          where: { id: { in: originalIds }, status: 'COMPLETED' },
        });
        if (completed === fixture.count) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(completed, fixture.count);
      assert.equal(
        await prisma.ingestionReceipt.count({ where: { serviceId: service.id } }),
        fixture.count
      );
      assert.equal(await prisma.alert.count({ where: { serviceId: service.id } }), fixture.count);
      assert.equal(
        await prisma.incident.count({ where: { serviceId: service.id } }),
        fixture.count
      );
      evidence.push({
        provider: fixture.type,
        accepted: fixture.count,
        completed,
        concurrentRetries: 12,
        originalReceiptsRecovered: true,
        unknownIdentityRejected: true,
        changedContentRejected: true,
        invalidCredentialRejected: true,
      });
    }
  } finally {
    const current = await getIngestionPolicy();
    await applyIngestionCommand(
      { action: 'configure', expectedRevision: current.revision, policy: previous.policy },
      actor.id
    );
  }
  return evidence;
};
