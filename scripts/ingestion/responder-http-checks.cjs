/* eslint-disable @typescript-eslint/no-require-imports -- Owned native certification fixture reuses production event and Automation modules. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AutomationMode } = require('@prisma/client');
const { observeSmtpDelivery } = require('./smtp-capture.cjs');

module.exports = async function prepareResponderChecks(options) {
  const { prisma, captureUrl } = options;
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
  assert.equal(database.port, '55445');
  assert.ok(database.pathname.startsWith('/ingestion_test_http_'));
  const [actual] = await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(actual.name, database.pathname.slice(1));
  const exercisePolicy = await require('./notification-http-checks.cjs')(options);
  const run = randomUUID();
  const recipient = `responder-${run}@example.test`;
  const actor = await prisma.user.create({
    data: {
      name: 'Owned fallback responder',
      email: recipient,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailNotificationsEnabled: true,
    },
  });
  const team = await prisma.team.create({
    data: { name: `Owned responders ${run}`, members: { create: { userId: actor.id } } },
  });
  const fallback = await prisma.service.create({
    data: { name: `Owned fallback ${run}`, teamId: team.id },
  });
  const suppressed = await prisma.service.create({
    data: { name: `Owned suppression ${run}`, teamId: team.id },
  });
  const integration = async service =>
    prisma.integration.create({
      data: {
        serviceId: service.id,
        name: 'Owned responder fixture',
        type: 'EVENTS_API_V2',
        key: randomUUID(),
      },
    });
  const fallbackIntegration = await integration(fallback);
  const suppressedIntegration = await integration(suppressed);
  const { compileAutomation } = require('../../src/lib/automation/compiler');
  const { emptySnapshot } = require('../../src/lib/automation/contract');
  const { checksum } = require('../../src/lib/automation/cache');
  const snapshot = {
    ...emptySnapshot,
    rules: [
      {
        id: 'suppress',
        name: 'Owned no-escalation route',
        enabled: true,
        phase: 'ROUTE',
        conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'responder-saturation' }],
        actions: [{ type: 'NO_ESCALATION' }],
      },
    ],
  };
  const { compiled, issues } = compileAutomation(snapshot);
  assert.ok(!issues.some(issue => issue.level === 'ERROR'), JSON.stringify(issues));
  const version = await prisma.automationVersion.create({
    data: {
      serviceId: suppressed.id,
      versionNumber: 1,
      snapshot,
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      publishedBy: actor.id,
      lintReport: [],
    },
  });
  await prisma.serviceAutomationConfig.create({
    data: { serviceId: suppressed.id, mode: 'LIVE', activeVersionId: version.id },
  });
  const backlog = await prisma.service.create({ data: { name: `Owned queue pressure ${run}` } });
  const backlogEvent = await require('../../src/lib/events').processEvent(
    {
      event_action: 'trigger',
      dedup_key: run,
      payload: {
        summary: 'Owned backlog fixture',
        source: 'responder-saturation',
        severity: 'critical',
      },
    },
    backlog.id,
    'owned-backlog'
  );
  assert.ok(backlogEvent.incident?.id);
  const prefix = `responder-pressure-${run}-`;
  await prisma.$transaction(
    async tx => {
      await tx.$executeRaw`INSERT INTO "WarRoomProviderEventDelivery" (id, provider, "idempotencyKey", "incidentId", kind, "eventPayload", "updatedAt")
      SELECT ${prefix} || n, 'SLACK'::"WarRoomProvider", ${prefix} || n, ${backlogEvent.incident.id}, 'TRIGGER',
        jsonb_build_object('kind', 'TRIGGER', 'incidentId', ${backlogEvent.incident.id}::text, 'incidentEventId', ${prefix}::text || n), clock_timestamp()
      FROM generate_series(1, 10000) n`;
      await tx.$executeRaw`INSERT INTO "BackgroundJob" (id, type, payload, "scheduledAt", "maxAttempts", "updatedAt")
      SELECT ${prefix} || 'general-' || n, 'WAR_ROOM_PROVIDER_EVENT'::"JobType", jsonb_build_object('deliveryId', ${prefix}::text || n), clock_timestamp() + INTERVAL '1 day', 5, clock_timestamp()
      FROM generate_series(1, 10000) n`;
      await tx.$executeRaw`INSERT INTO "BackgroundJob" (id, type, payload, "scheduledAt", "maxAttempts", "updatedAt")
      SELECT ${prefix} || 'bulk-' || n, 'STATUS_PAGE_NOTIFICATION'::"JobType", jsonb_build_object('incidentId', ${backlogEvent.incident.id}::text, 'eventType', 'triggered'), clock_timestamp() + INTERVAL '1 day', 5, clock_timestamp()
      FROM generate_series(1, 10000) n`;
    },
    { timeout: 60000, maxWait: 2000 }
  );

  const remaining = async () => {
    const rows = await prisma.backgroundJob.groupBy({
      by: ['type'],
      where: {
        id: { startsWith: prefix },
        status: { in: ['PENDING', 'PROCESSING'] },
        scheduledAt: { lte: new Date() },
      },
      _count: { _all: true },
    });
    const count = type => rows.find(row => row.type === type)?._count._all || 0;
    return { general: count('WAR_ROOM_PROVIDER_EVENT'), bulk: count('STATUS_PAGE_NOTIFICATION') };
  };
  const submit = async (baseUrl, target, key) => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Token token=${target.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        event_action: 'trigger',
        dedup_key: key,
        payload: {
          summary: `Owned responder ${key}`,
          source: 'responder-saturation',
          severity: 'critical',
        },
      }),
    });
    assert.equal(response.status, 202, 'Responder fixture admission failed');
    const receiptId = (await response.json()).data?.result?.receiptId;
    assert.equal(typeof receiptId, 'string');
    return receiptId;
  };
  return async function exercise({ baseUrl, loadActive }) {
    assert.ok(loadActive());
    await prisma.$executeRaw`UPDATE "BackgroundJob" SET "scheduledAt"=clock_timestamp() WHERE id LIKE ${prefix + '%'} AND status='PENDING'`;
    const policy = await exercisePolicy({ baseUrl, loadActive });
    const started = Date.now();
    const key = `${run}-fallback`;
    const receiptId = await submit(baseUrl, fallbackIntegration, key);
    const delivered = await observeSmtpDelivery({
      prisma,
      receiptId,
      recipient,
      userId: actor.id,
      subjectToken: key,
      captureUrl,
    });
    const fallbackMs = Date.now() - started;
    const pressure = await remaining();
    assert.equal(
      await prisma.backgroundJob.count({
        where: {
          type: 'ESCALATION',
          payload: { path: ['incidentId'], equals: delivered.receipt.result.incidentId },
        },
      }),
      0,
      'Fallback fixture unexpectedly used an escalation policy'
    );
    let personalCompleted = 0;
    const personalDeadline = Date.now() + 5000;
    do {
      personalCompleted = await prisma.backgroundJob.count({
        where: {
          type: 'SCHEDULED_TASK',
          status: 'COMPLETED',
          AND: [
            { payload: { path: ['incidentId'], equals: delivered.receipt.result.incidentId } },
            { payload: { path: ['lane'], equals: 'PERSONAL_NOTIFICATION' } },
          ],
        },
      });
      if (personalCompleted === 1) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < personalDeadline);
    assert.equal(personalCompleted, 1, 'Fallback responder intent did not finish');

    const suppressionKey = `${run}-suppressed`;
    const {
      normalizeDedupKeys,
      lockEventDedupKeys,
    } = require('../../src/lib/incidents/event-identity');
    const keys = normalizeDedupKeys(suppressionKey, suppressedIntegration.id, {
      summary: `Owned responder ${suppressionKey}`,
      source: 'responder-saturation',
      severity: 'critical',
    });
    let release;
    let ready;
    const held = new Promise(resolve => {
      release = resolve;
    });
    const acquired = new Promise(resolve => {
      ready = resolve;
    });
    const blocker = prisma.$transaction(
      async tx => {
        await lockEventDedupKeys(tx, suppressed.id, [keys.primary, keys.legacy].filter(Boolean));
        ready();
        await held;
      },
      { timeout: 15000, maxWait: 2000 }
    );
    let suppressedReceiptId;
    try {
      await Promise.race([
        acquired,
        blocker.then(() => {
          throw new Error('Responder fixture lock ended early');
        }),
      ]);
      suppressedReceiptId = await submit(baseUrl, suppressedIntegration, suppressionKey);
      const queued = await prisma.ingestionReceipt.findUniqueOrThrow({
        where: { id: suppressedReceiptId },
      });
      assert.notEqual(
        queued.status,
        'COMPLETED',
        'Automation mutation did not precede incident processing'
      );
      await prisma.serviceAutomationConfig.update({
        where: { serviceId: suppressed.id },
        data: { mode: AutomationMode.DISABLED },
      });
    } finally {
      release();
      await blocker;
    }
    const deadline = Date.now() + 90000;
    let receipt,
      decision,
      settled = false;
    while (Date.now() < deadline) {
      receipt = await prisma.ingestionReceipt.findUniqueOrThrow({
        where: { id: suppressedReceiptId },
      });
      assert.notEqual(receipt.status, 'DEAD');
      if (receipt.status === 'COMPLETED') {
        decision = await prisma.incidentAutomationDecision.findUnique({
          where: { incidentId: receipt.result.incidentId },
        });
        assert.ok(decision, 'Completed incident lacks its captured Automation decision');
        assert.equal(
          await prisma.backgroundJob.count({
            where: {
              type: 'SCHEDULED_TASK',
              AND: [
                { payload: { path: ['incidentId'], equals: receipt.result.incidentId } },
                { payload: { path: ['lane'], equals: 'PERSONAL_NOTIFICATION' } },
              ],
            },
          }),
          0,
          'Captured NO_ESCALATION persisted a responder intent'
        );
        settled = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(settled, 'Suppressed incident did not settle');
    assert.equal(decision?.versionId, version.id);
    assert.equal(decision.mode, 'LIVE');
    assert.equal(decision.routeType, 'NO_ESCALATION');
    assert.equal(
      await prisma.notification.count({ where: { incidentId: receipt.result.incidentId } }),
      0,
      'Captured NO_ESCALATION queued a notification'
    );
    const messagesResponse = await fetch(`${captureUrl}/api/v1/messages`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.ok(messagesResponse.ok);
    const { messages } = await messagesResponse.json();
    assert.ok(
      !messages?.some(message => message.Subject?.includes(suppressionKey)),
      'Captured NO_ESCALATION sent mail'
    );
    const responderChecksPassed =
      pressure.general > 0 &&
      pressure.bulk > 0 &&
      fallbackMs < 5000 &&
      policy.captureObservedMs < 5000;
    return {
      ...policy,
      capturedDuringLoad: policy.capturedDuringLoad && loadActive(),
      responderChecksPassed,
      fallback: {
        smtpCaptured: true,
        durableDeliveryRecorded: true,
        personalIntentCompleted: true,
        captureObservedMs: fallbackMs,
        latencyLimitMs: 5000,
        generalBacklogRemaining: pressure.general,
        bulkBacklogRemaining: pressure.bulk,
      },
      suppression: {
        capturedLiveVersionPreserved: true,
        configChangedToDisabledWhileQueued: true,
        noResponderIntent: true,
        noNotificationIntent: true,
        noCapturedMail: true,
      },
      scope:
        'Owned native policy and fallback SMTP plus queued Automation suppression during 10,000 valid general and 10,000 bulk fixture jobs. No Internet mailbox, sustained capacity or full backlog-drain certification.',
    };
  };
};
