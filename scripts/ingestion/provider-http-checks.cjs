const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const { encrypt } = require('../../src/lib/encryption');

module.exports = async function providerHttpChecks({ prisma, baseUrl, consumeIngestionBatch }) {
  const run = randomUUID();
  const fixtures = [
    ...require('./formatted-http-fixtures.cjs')(run),
    ...require('./additional-http-fixtures.cjs')(run),
    ...require('./monitoring-http-fixtures.cjs')(run),
    {
      type: 'PROMETHEUS',
      route: 'prometheus',
      count: 40,
      payload: {
        version: '4',
        groupKey: run,
        status: 'firing',
        receiver: 'certifier',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: { api_key: 'fixture-credential-must-not-persist' },
        externalURL: '',
        alerts: Array.from({ length: 40 }, (_, index) => ({
          status: 'firing',
          labels: { alertname: `${run}-${index}` },
          annotations: { summary: `HTTP batch ${index}`, context: 'x'.repeat(8000) },
          startsAt: '2026-10-23T00:00:00Z',
          fingerprint: `${run}-${index}`,
        })),
      },
    },
    {
      type: 'GRAFANA',
      route: 'grafana',
      count: 2,
      signed: true,
      payload: {
        status: 'firing',
        alerts: [0, 1].map(index => ({
          status: 'firing',
          labels: { alertname: `${run}-grafana-${index}` },
          annotations: { summary: `Grafana child ${index}` },
          startsAt: '2026-10-23T00:00:00Z',
        })),
      },
    },
    {
      type: 'DATADOG',
      route: 'datadog',
      count: 2,
      payload: [0, 1].map(index => ({
        title: `Datadog child ${index}`,
        aggregation_key: `${run}-datadog-${index}`,
        alert_type: 'error',
        host: 'http-certifier',
        text: 'Capacity fixture',
      })),
    },
    {
      type: 'WEBHOOK',
      route: 'webhook',
      count: 1,
      payload: {
        summary: 'Webhook fixture',
        dedup_key: `${run}-webhook`,
        severity: 'critical',
        status: 'triggered',
        source: 'http-certifier',
        context: { headers: { 'x-api-key': 'fixture-credential-must-not-persist' } },
      },
    },
  ];
  const evidence = [];
  let previous;
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const key = randomUUID();
    const signatureSecret = randomUUID();
    const service = await prisma.service.create({
      data: { name: `Provider HTTP ${fixture.type} ${fixtureIndex} ${run}` },
    });
    const integration = await prisma.integration.create({
      data: {
        name: 'Isolated provider HTTP fixture',
        type: fixture.type,
        serviceId: service.id,
        key: await encrypt(key),
        signatureSecret: fixture.signed ? await encrypt(signatureSecret) : null,
      },
    });
    const endpoint = `${baseUrl}/api/integrations/${fixture.route}?integrationId=${integration.id}`;
    const body =
      fixture.encoding === 'form'
        ? new URLSearchParams(fixture.payload).toString()
        : fixture.encoding === 'pubsub'
          ? JSON.stringify({
              message: {
                data: Buffer.from(JSON.stringify(fixture.payload)).toString('base64'),
                messageId: run,
              },
              subscription: 'isolated-http-fixture',
            })
          : JSON.stringify(fixture.payload);
    const credentialHeader = fixture.credentialHeader || 'X-Integration-Key';
    const credential = value => (credentialHeader === 'Authorization' ? `Bearer ${value}` : value);
    const headers = {
      'Content-Type':
        fixture.encoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
      [credentialHeader]: credential(key),
      'Idempotency-Key': `${run}:${fixture.type}`,
    };
    const signatureHeader =
      {
        GRAFANA: 'x-grafana-signature',
        GITHUB: 'x-hub-signature-256',
        GITLAB: 'x-gitlab-token',
        SENTRY: 'sentry-hook-signature',
        VERCEL: 'x-vercel-signature',
      }[fixture.type] || 'x-signature';
    if (fixture.signed) {
      headers[signatureHeader] =
        fixture.type === 'GITLAB'
          ? signatureSecret
          : (fixture.type === 'GITHUB' ? 'sha256=' : '') +
            createHmac(fixture.type === 'VERCEL' ? 'sha1' : 'sha256', signatureSecret)
              .update(body)
              .digest('hex');
      headers['x-request-id'] = `${run}:${fixture.type}`;
      headers['x-github-delivery'] = `${run}:${fixture.type}`;
      headers['sentry-hook-id'] = `${run}:${fixture.type}`;
      headers['sentry-hook-timestamp'] = String(Math.floor(Date.now() / 1000));
    }
    const post = overrides =>
      fetch(endpoint, { method: 'POST', headers: { ...headers, ...overrides }, body });
    const unauthorized = await post({
      [credentialHeader]: credential('invalid-fixture-credential'),
    });
    assert.ok(unauthorized.status >= 400, `${fixture.type} invalid credentials accepted`);
    if (fixture.signed) {
      const invalidSignature = await post({ [signatureHeader]: 'invalid' });
      assert.equal(
        invalidSignature.status,
        401,
        `${fixture.type} invalid signature/token accepted`
      );
    }
    assert.equal(await prisma.ingestionReceipt.count({ where: { serviceId: service.id } }), 0);
    const response = await post({});
    const result = await response.json();
    assert.equal(
      response.status,
      202,
      `${fixture.type} admission failed: ${JSON.stringify(result)}`
    );
    const receipts = await prisma.ingestionReceipt.findMany({ where: { serviceId: service.id } });
    assert.equal(receipts.length, fixture.count);
    const responseIds = JSON.stringify(result);
    for (const receipt of receipts)
      assert.ok(responseIds.includes(receipt.id), `${fixture.type} receipt missing from response`);
    const duplicate = await post({});
    assert.ok([200, 202].includes(duplicate.status));
    assert.equal(
      await prisma.ingestionReceipt.count({ where: { serviceId: service.id } }),
      fixture.count
    );
    if (fixture.type === 'PAGERDUTY') {
      const alias = await fetch(
        `${baseUrl}/api/integrations/pagerduty/v2/enqueue?integrationId=${integration.id}`,
        { method: 'POST', headers, body }
      );
      assert.ok(
        [200, 202].includes(alias.status),
        'PagerDuty v2 alias rejected a compatible request'
      );
      assert.equal(
        await prisma.ingestionReceipt.count({ where: { serviceId: service.id } }),
        fixture.count
      );
    }
    const first = receipts[0];
    const statusUrl = `${baseUrl}/api/events/receipts/${first.id}?integrationId=${integration.id}`;
    const inspection = await fetch(statusUrl, { headers: { 'X-Integration-Key': key } });
    assert.equal(inspection.status, 200, 'Integration receipt inspection rejected');
    const inspectionText = await inspection.text();
    assert.ok(!inspectionText.includes('envelope') && !inspectionText.includes('leaseToken'));
    const serviceIsolationChecked = !!previous;
    if (previous) {
      const isolated = await fetch(
        `${baseUrl}/api/events/receipts/${previous.receiptId}?integrationId=${integration.id}`,
        { headers: { 'X-Integration-Key': key } }
      );
      assert.equal(isolated.status, 404, 'Cross-integration receipt inspection succeeded');
    }
    previous = { receiptId: first.id };
    const oversized = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(oversized.status, 413, 'Existing request body cap not enforced');
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (
        !(await prisma.ingestionReceipt.count({
          where: { serviceId: service.id, status: { not: 'COMPLETED' } },
        }))
      )
        break;
      if (!(await consumeIngestionBatch(8))) await new Promise(resolve => setTimeout(resolve, 50));
    }
    const completed = await prisma.ingestionReceipt.count({
      where: { serviceId: service.id, status: 'COMPLETED' },
    });
    assert.equal(completed, fixture.count);
    assert.equal(await prisma.alert.count({ where: { serviceId: service.id } }), fixture.count);
    assert.equal(await prisma.incident.count({ where: { serviceId: service.id } }), fixture.count);
    if (fixture.expectedSummary) {
      const incident = await prisma.incident.findFirstOrThrow({
        where: { serviceId: service.id },
        select: { title: true },
      });
      assert.ok(
        incident.title.includes(fixture.expectedSummary),
        `${fixture.type} ${fixture.format} lost its source summary`
      );
    }
    const stored = JSON.stringify(
      await Promise.all([
        prisma.ingestionReceipt.findMany({
          where: { serviceId: service.id },
          select: { envelope: true, result: true },
        }),
        prisma.ingestionBatch.findMany({
          where: { serviceId: service.id },
          select: { payload: true },
        }),
        prisma.alert.findMany({
          where: { serviceId: service.id },
          select: { payload: true },
        }),
        prisma.incident.findMany({
          where: { serviceId: service.id },
          select: { title: true, description: true },
        }),
      ])
    );
    assert.ok(!stored.includes('fixture-credential-must-not-persist'));
    evidence.push({
      provider: fixture.type,
      requestBytes: Buffer.byteLength(body),
      accepted: receipts.length,
      completed,
      receiptsExposed: true,
      duplicateReconciled: true,
      invalidCredentialsRejected: true,
      signatureChecked: !!fixture.signed,
      signatureKind: fixture.signed
        ? fixture.type === 'GITLAB'
          ? 'shared-token'
          : 'HMAC'
        : undefined,
      format: fixture.format || 'JSON',
      serviceIsolationChecked,
      oversizedRequestRejected: true,
      persistedPayloadsChecked: true,
    });
  }
  return evidence;
};
