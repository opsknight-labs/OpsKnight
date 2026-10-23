const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const { encrypt } = require('../../src/lib/encryption');

module.exports = async function providerHttpChecks({ prisma, baseUrl, consumeIngestionBatch }) {
  const run = randomUUID();
  const fixtures = [
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
        commonAnnotations: {},
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
  for (const fixture of fixtures) {
    const key = randomUUID();
    const signatureSecret = randomUUID();
    const service = await prisma.service.create({
      data: { name: `Provider HTTP ${fixture.type} ${run}` },
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
    const body = JSON.stringify(fixture.payload);
    const headers = {
      'Content-Type': 'application/json',
      'X-Integration-Key': key,
      'Idempotency-Key': `${run}:${fixture.type}`,
    };
    if (fixture.signed) {
      headers['x-grafana-signature'] = createHmac('sha256', signatureSecret)
        .update(body)
        .digest('hex');
      headers['x-request-id'] = `${run}:${fixture.type}`;
    }
    const post = overrides =>
      fetch(endpoint, { method: 'POST', headers: { ...headers, ...overrides }, body });
    const unauthorized = await post({ 'X-Integration-Key': 'invalid-fixture-credential' });
    assert.ok(unauthorized.status >= 400, `${fixture.type} invalid credentials accepted`);
    if (fixture.signed) {
      const invalidSignature = await post({ 'x-grafana-signature': 'invalid' });
      assert.equal(invalidSignature.status, 401, 'Invalid Grafana signature accepted');
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
    const stored = JSON.stringify(
      await prisma.ingestionReceipt.findMany({
        where: { serviceId: service.id },
        select: { envelope: true, result: true },
      })
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
      serviceIsolationChecked,
      oversizedRequestRejected: true,
    });
  }
  return evidence;
};
