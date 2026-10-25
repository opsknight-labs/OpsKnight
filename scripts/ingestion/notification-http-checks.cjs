/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture shares the production TypeScript configuration and compiler modules. */
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');

// The production notification configuration service encrypts the fixture secret
// and audits configuration. SMTP remains confined to an owned capture container.
module.exports = async function prepareNotificationCheck({ prisma, smtpHost, captureUrl }) {
  const run = randomUUID();
  const recipient = `ingestion-page-${run}@example.test`;
  const actor = await prisma.user.create({
    data: {
      name: 'Owned paging certifier',
      email: recipient,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailNotificationsEnabled: true,
    },
  });
  const existing = await prisma.notificationProvider.findUnique({ where: { provider: 'smtp' } });
  const { saveNotificationProvider } = require('../../src/lib/notifications/providers');
  await saveNotificationProvider({
    provider: 'smtp',
    enabled: true,
    actorId: actor.id,
    expectedRevision: existing?.revision ?? null,
    config: {
      host: smtpHost,
      port: 1025,
      user: 'owned-fixture',
      password: randomBytes(32).toString('hex'),
      fromEmail: 'ingestion-certifier@example.test',
      secure: false,
    },
  });
  const policy = await prisma.escalationPolicy.create({
    data: {
      name: `Owned paging ${run}`,
      steps: {
        create: {
          stepOrder: 0,
          delayMinutes: 0,
          targetType: 'USER',
          targetUserId: actor.id,
          notificationChannels: ['EMAIL'],
        },
      },
    },
  });
  const service = await prisma.service.create({
    data: { name: `Owned SMTP ${run}`, escalationPolicyId: policy.id },
  });
  const { compileAutomation } = require('../../src/lib/automation/compiler');
  const { emptySnapshot } = require('../../src/lib/automation/contract');
  const { checksum } = require('../../src/lib/automation/cache');
  const snapshot = {
    ...emptySnapshot,
    rules: [
      {
        id: 'promote',
        name: 'Owned P1 promotion',
        enabled: true,
        phase: 'ENRICH',
        conditions: [],
        actions: [{ type: 'SET_PRIORITY', value: 'P1' }],
      },
    ],
  };
  const { compiled, issues } = compileAutomation(snapshot);
  assert.ok(!issues.some(issue => issue.level === 'ERROR'), 'Paging Automation fixture is invalid');
  const version = await prisma.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 1,
      snapshot,
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      publishedBy: actor.id,
      lintReport: [],
    },
  });
  await prisma.serviceAutomationConfig.create({
    data: { serviceId: service.id, mode: 'LIVE', activeVersionId: version.id },
  });
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const integration = await prisma.integration.create({
    data: {
      serviceId: service.id,
      name: 'Owned SMTP fixture',
      type: 'EVENTS_API_V2',
      key: randomUUID(),
    },
  });
  return async function exercise({ baseUrl, loadActive }) {
    assert.ok(loadActive(), 'Paging fixture must start during active ingestion load');
    const started = Date.now();
    const response = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Token token=${integration.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': run,
      },
      body: JSON.stringify({
        event_action: 'trigger',
        dedup_key: run,
        payload: {
          summary: `Owned critical page ${run}`,
          source: 'owned-smtp-fixture',
          severity: 'warning',
        },
      }),
    });
    assert.equal(response.status, 202, 'Paging fixture admission failed');
    const receiptId = (await response.json()).data?.result?.receiptId;
    assert.equal(typeof receiptId, 'string');
    const { receipt, notification } = await require('./smtp-capture.cjs').observeSmtpDelivery({
      prisma,
      receiptId,
      recipient,
      userId: actor.id,
      subjectToken: run,
      captureUrl,
    });
    const incident = await prisma.incident.findUniqueOrThrow({
      where: { id: receipt.result.incidentId },
    });
    assert.equal(incident.priority, 'P1', 'Pinned Automation did not promote the source warning');
    const decision = await prisma.incidentAutomationDecision.findFirstOrThrow({
      where: { incidentId: incident.id },
    });
    assert.equal(decision.versionId, version.id);
    assert.equal(await prisma.alert.count({ where: { serviceId: service.id } }), 1);
    const captureMs = Date.now() - started;
    return {
      receiptId,
      incidentId: receipt.result.incidentId,
      notificationId: notification.id,
      smtpCaptured: true,
      durableDeliveryRecorded: true,
      captureObservedMs: captureMs,
      startedDuringLoad: true,
      capturedDuringLoad: loadActive(),
      provider: 'smtp',
      pinnedAutomationVerified: true,
      sourceSeverity: 'warning',
      finalPriority: 'P1',
      scope:
        'Real application workers and SMTP transport to owned local capture only; no Internet delivery or remote mailbox certification',
    };
  };
};
