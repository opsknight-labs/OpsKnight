const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { compileAutomation } = require('../../src/lib/automation/compiler');
const { emptySnapshot } = require('../../src/lib/automation/contract');
const { checksum } = require('../../src/lib/automation/cache');
const {
  lockEventDedupKeys,
  normalizeDedupKeys,
} = require('../../src/lib/incidents/event-identity');

module.exports = async function lifecycleHttpChecks({ prisma, baseUrl, consumeIngestionBatch }) {
  const run = randomUUID();
  const service = await prisma.service.create({ data: { name: `HTTP lifecycle ${run}` } });
  const integration = await prisma.integration.create({
    data: {
      serviceId: service.id,
      name: 'Isolated lifecycle fixture',
      type: 'EVENTS_API_V2',
      key: randomUUID(),
    },
  });
  const actor = await prisma.user.create({
    data: {
      name: 'Lifecycle certifier',
      email: `ingestion-lifecycle-${run}@example.test`,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  const previous = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { automationEnabled: true },
  });
  const snapshot = {
    ...emptySnapshot,
    rules: [
      {
        id: 'no-escalation',
        name: 'Fixture route',
        enabled: true,
        phase: 'ROUTE',
        conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'http-lifecycle' }],
        actions: [{ type: 'NO_ESCALATION' }],
      },
    ],
  };
  const publish = number => {
    const versionSnapshot = number === 1 ? snapshot : emptySnapshot;
    const { compiled, issues } = compileAutomation(versionSnapshot);
    assert.ok(
      !issues.some(item => item.level === 'ERROR'),
      'Lifecycle Automation fixture must pass compiler lint'
    );
    return prisma.automationVersion.create({
      data: {
        serviceId: service.id,
        versionNumber: number,
        snapshot: versionSnapshot,
        compiledSnapshot: compiled,
        checksum: checksum(compiled),
        publishedBy: actor.id,
        lintReport: [],
      },
    });
  };
  const payload = {
    summary: 'HTTP lifecycle incident',
    source: 'http-lifecycle',
    severity: 'critical',
  };
  const post = async (action, key, delivery) => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        Authorization: `Token token=${integration.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': delivery,
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ event_action: action, dedup_key: key, payload }),
    });
    const body = await response.json();
    assert.equal(response.status, 202, `Lifecycle ${action} admission failed`);
    assert.equal(typeof body.data?.result?.receiptId, 'string');
    return body.data.result.receiptId;
  };
  const complete = async receiptId => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await consumeIngestionBatch(4);
      const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receiptId } });
      if (receipt.status === 'COMPLETED') return receipt;
      assert.notEqual(receipt.status, 'DEAD', 'Lifecycle event dead-lettered');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Lifecycle receipt did not complete');
  };
  const incidentCounts = async incidentId => ({
    timeline: await prisma.incidentEvent.count({ where: { incidentId } }),
    outbox: await prisma.backgroundJob.count({
      where: { payload: { path: ['incidentId'], equals: incidentId } },
    }),
  });
  try {
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: true },
      update: { automationEnabled: true },
    });
    const firstVersion = await publish(1);
    await prisma.serviceAutomationConfig.create({
      data: { serviceId: service.id, mode: 'LIVE', activeVersionId: firstVersion.id },
    });
    let release;
    let acquired;
    const released = new Promise(resolve => {
      release = resolve;
    });
    const locked = new Promise(resolve => {
      acquired = resolve;
    });
    const identities = normalizeDedupKeys('lifecycle', integration.id, payload);
    const blocking = prisma.$transaction(
      async tx => {
        await lockEventDedupKeys(tx, service.id, [
          identities.primary,
          ...(identities.legacy ? [identities.legacy] : []),
        ]);
        acquired();
        await released;
      },
      { timeout: 30000 }
    );
    let triggerId;
    try {
      await Promise.race([
        locked,
        blocking.then(() => {
          throw new Error('Lifecycle fixture lock ended before acquisition');
        }),
      ]);
      triggerId = await post('trigger', 'lifecycle', `${run}:trigger`);
      const newer = await publish(2);
      await prisma.serviceAutomationConfig.update({
        where: { serviceId: service.id },
        data: { activeVersionId: newer.id },
      });
      assert.equal(await prisma.incident.count({ where: { serviceId: service.id } }), 0);
    } finally {
      release();
      await blocking;
    }
    const trigger = await complete(triggerId);
    const incidentId = trigger.result.incidentId;
    assert.equal(
      (await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })).status,
      'OPEN'
    );
    const decision = await prisma.incidentAutomationDecision.findFirstOrThrow({
      where: { incidentId },
    });
    assert.equal(
      decision.versionId,
      firstVersion.id,
      'Queued event lost its accepted Automation version'
    );
    assert.equal(decision.routeType, 'NO_ESCALATION');
    const createdJobs = await prisma.backgroundJob.findMany({
      where: { payload: { path: ['incidentId'], equals: incidentId } },
      select: { type: true, payload: true },
    });
    assert.ok(
      createdJobs.some(job => job.type === 'RUNBOOK' && job.payload.kind === 'EVALUATE_TRIGGER')
    );
    assert.ok(
      !createdJobs.some(job => job.payload.effect === 'TRIGGER_ESCALATION_NOTIFICATIONS'),
      'NO_ESCALATION must suppress automatic responder paging'
    );
    const initialCounts = await incidentCounts(incidentId);
    assert.equal(await post('trigger', 'lifecycle', `${run}:trigger`), triggerId);
    assert.deepEqual(await incidentCounts(incidentId), initialCounts);
    await complete(await post('acknowledge', 'lifecycle', `${run}:ack`));
    assert.equal(
      (await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })).status,
      'ACKNOWLEDGED'
    );
    const acknowledgedCounts = await incidentCounts(incidentId);
    await complete(await post('acknowledge', 'lifecycle', `${run}:ack-again`));
    assert.deepEqual(
      await incidentCounts(incidentId),
      acknowledgedCounts,
      'Repeated ACK duplicated transition effects'
    );
    await complete(await post('resolve', 'lifecycle', `${run}:resolve`));
    assert.equal(
      (await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })).status,
      'RESOLVED'
    );
    const reopened = await complete(await post('trigger', 'lifecycle', `${run}:retrigger`));
    assert.notEqual(reopened.result.incidentId, incidentId);
    assert.equal(
      (await prisma.incident.findUniqueOrThrow({ where: { id: reopened.result.incidentId } }))
        .status,
      'OPEN'
    );
    assert.ok(
      await prisma.backgroundJob.count({
        where: {
          payload: {
            path: ['incidentId'],
            equals: reopened.result.incidentId,
          },
          AND: [{ payload: { path: ['effect'], equals: 'TRIGGER_ESCALATION_NOTIFICATIONS' } }],
        },
      })
    );
    await complete(await post('resolve', 'resolve-first', `${run}:early-resolve`));
    const delayed = await complete(await post('trigger', 'resolve-first', `${run}:late-trigger`));
    assert.equal(
      (await prisma.incident.findUniqueOrThrow({ where: { id: delayed.result.incidentId } }))
        .status,
      'RESOLVED'
    );
    assert.equal(
      await prisma.ingestionReceipt.count({
        where: { serviceId: service.id, status: { not: 'COMPLETED' } },
      }),
      0
    );
    return {
      passed: true,
      automationVersionPinned: true,
      lifecycle: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'new OPEN incident'],
      repeatedAckEffectsDeduplicated: true,
      deliveryRetryReused: true,
      resolveBeforeTriggerPreserved: true,
      runbookEvaluationIntentPersisted: true,
      escalationNotificationIntentPersisted: true,
      noEscalationRuleRespected: true,
      externalEffectsDelivered: false,
      scope:
        'Real HTTP, durable processing, Service Automation decision and transactional downstream intents; external delivery not exercised',
    };
  } finally {
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: previous?.automationEnabled ?? false },
    });
  }
};
