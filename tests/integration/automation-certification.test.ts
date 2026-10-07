/* eslint-disable security/detect-object-injection -- Field names are a fixed typed test list. */
import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestUser,
  createTestNotificationProvider,
} from '../helpers/test-db';
import { processEvent, processIntegrationEvent, type EventPayload } from '@/lib/events';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import { resolveIncidentResponderRouting } from '@/lib/escalation/routing';
import { executeEscalation } from '@/lib/escalation';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { claimPendingJobs, processJob, GENERAL_WORKER_EXCLUDED_JOB_TYPES } from '@/lib/jobs/queue';
import { prepareAutomation, persistAutomation } from '@/lib/automation/runtime';
import { processAutomationJob } from '@/lib/automation/jobs';
import { emptySnapshot, type Snapshot } from '@/lib/automation/contract';
import { checksum } from '@/lib/automation/cache';
vi.mock('@/lib/slack', () => ({ sendSlackMessageToChannel: vi.fn() }));
vi.mock('@/lib/notification-control-plane', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/notification-control-plane')>()),
  // Verify durable intent production without contacting an external provider.
  deliverCentralNotification: vi.fn(async () => ({ success: false })),
}));
const event: EventPayload = {
  event_action: 'trigger',
  dedup_key: 'certification',
  payload: {
    summary: 'Test incident',
    source: 'certification',
    severity: 'error',
    custom_details: { environment: 'staging' },
  },
};
const snapshot: Snapshot = {
  schemaVersion: 1,
  fields: [
    {
      fieldId: 'env',
      key: 'environment',
      label: 'Environment',
      type: 'ENUM',
      caseSensitive: false,
      allowedValues: ['production', 'staging'],
      aliases: { prd: 'production' },
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
    },
  ],
  rules: [
    {
      id: 'enrich',
      name: 'Final priority',
      phase: 'ENRICH',
      enabled: true,
      conditions: [],
      actions: [
        { type: 'SET_PRIORITY', value: 'P1' },
        { type: 'ADD_TAG', value: 'automated' },
      ],
    },
    {
      id: 'no-page',
      name: 'Non-production',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'environment', operator: 'NE', value: 'production' }],
      actions: [{ type: 'NO_ESCALATION' }],
    },
  ],
};
async function setup(policy: Snapshot = snapshot, mode: 'SHADOW' | 'LIVE' = 'LIVE') {
  const service = await db.service.create({ data: { name: 'Automation certification' } });
  const actor = await createTestUser({ role: 'ADMIN' });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: actor.id,
    snapshot: policy,
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: actor.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await changeMode({
    serviceId: service.id,
    actorId: actor.id,
    mode,
    expectedActiveVersionId: version.id,
  });
  return { service, actor, draft, version };
}
async function ingest(serviceId: string, incoming: EventPayload = event) {
  return processIntegrationEvent({
    serviceId,
    integrationId: 'cert',
    integrationType: 'EVENTS_API',
    event: structuredClone(incoming),
    providerPayload: incoming,
    receivedAt: new Date(),
  });
}
describe('service automation transaction certification', () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: true },
      update: { automationEnabled: true },
    });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it('50 concurrent duplicates create one incident, decision, trace, logical outbox', async () => {
    const { service } = await setup();
    const results = await Promise.all(Array.from({ length: 50 }, () => ingest(service.id)));
    expect(new Set(results.map(r => ('incident' in r ? r.incident?.id : null))).size).toBe(1);
    expect(await db.incident.count()).toBe(1);
    expect(await db.incidentAutomationDecision.count()).toBe(1);
    expect(await db.automationTrace.count()).toBe(1);
    expect(await db.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(0);
    const jobs = await db.backgroundJob.findMany();
    expect(
      jobs.filter(
        j => (j.payload as { effect?: string }).effect === 'TRIGGER_ESCALATION_NOTIFICATIONS'
      )
    ).toHaveLength(0);
    expect(
      jobs.filter(j => (j.payload as { effect?: string }).effect === 'TRIGGER_SERVICE_NOTIFICATION')
    ).toHaveLength(1);
    const incident = await db.incident.findFirstOrThrow();
    expect(incident.priority).toBe('P1');
    expect(incident.slaPriorityAtCapture).toBe('P1');
    expect(incident.slaAckTargetMs).toBe(300000);
    expect((await executeEscalation(incident.id)).outcome).toBe('RESPONDER_ROUTE_NONE');
    expect(await db.incidentTag.count()).toBe(1);
  }, 60000);
  it('missing and unmapped values cannot disable paging', async () => {
    const { service } = await setup();
    for (const [key, details] of [
      ['missing', {}],
      ['unmapped', { environment: 'stg-2' }],
    ] as const)
      await ingest(service.id, {
        ...event,
        dedup_key: key,
        payload: { ...event.payload, custom_details: details },
      });
    const decisions = await db.incidentAutomationDecision.findMany();
    expect(decisions.map(d => d.routeType)).toEqual(['SERVICE_DEFAULT', 'SERVICE_DEFAULT']);
  });
  it('shadow is operationally equivalent to globally disabled', async () => {
    const { service } = await setup(snapshot, 'SHADOW');
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: false },
      update: { automationEnabled: false },
    });
    const off = await ingest(service.id, { ...event, dedup_key: 'off' });
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: true },
      update: { automationEnabled: true },
    });
    const shadow = await ingest(service.id, { ...event, dedup_key: 'shadow' });
    const incidents = await db.incident.findMany({ orderBy: { createdAt: 'asc' } });
    for (const field of [
      'priority',
      'urgency',
      'slaAckTargetMs',
      'slaResolveTargetMs',
      'slaPriorityAtCapture',
      'escalationStatus',
      'classificationPrioritySource',
    ] as const)
      expect(incidents[0][field]).toEqual(incidents[1][field]);
    const effects = async (result: typeof off) =>
      (await db.backgroundJob.findMany())
        .filter(
          j =>
            (j.payload as { incidentId?: string }).incidentId ===
            ('incident' in result ? result.incident?.id : '')
        )
        .map(j => (j.payload as { effect?: string }).effect)
        .filter(Boolean)
        .sort();
    expect(await effects(off)).toEqual(await effects(shadow));
    expect(await db.incidentAutomationDecision.count()).toBe(0);
    expect(await db.incidentTag.count()).toBe(0);
    expect(await db.automationTrace.count()).toBe(1);
    expect((await db.automationShadowAggregate.findFirstOrThrow()).priorityDifferent).toBe(1);
  });
  it('pins policy B through default changes, resume, reopen, and emergency disable', async () => {
    const service = await db.service.create({ data: { name: 'Pinned service' } });
    const actor = await createTestUser({ role: 'ADMIN' });
    const policies = await Promise.all(
      ['A', 'B', 'C'].map(name =>
        db.escalationPolicy.create({
          data: {
            name,
            steps: {
              create: [
                {
                  delayMinutes: name === 'B' ? 7 : 1,
                  stepOrder: 0,
                  targetType: 'USER',
                  targetUserId: actor.id,
                  notificationChannels: ['EMAIL'],
                },
                {
                  delayMinutes: 3,
                  stepOrder: 1,
                  targetType: 'USER',
                  targetUserId: actor.id,
                  notificationChannels: ['EMAIL'],
                },
              ],
            },
          },
        })
      )
    );
    await db.service.update({
      where: { id: service.id },
      data: { escalationPolicyId: policies[0].id },
    });
    const policy: Snapshot = {
      ...emptySnapshot,
      rules: [
        {
          id: 'b',
          name: 'Policy B',
          phase: 'ROUTE',
          enabled: true,
          conditions: [],
          actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policies[1].id }],
        },
      ],
    };
    const draft = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      snapshot: policy,
      expectedRevision: 0,
    });
    const version = await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: draft.revision,
      expectedActiveVersionId: null,
    });
    await changeMode({
      serviceId: service.id,
      actorId: actor.id,
      mode: 'LIVE',
      expectedActiveVersionId: version.id,
    });
    await ingest(service.id);
    const incident = await db.incident.findFirstOrThrow();
    expect(incident.nextEscalationAt!.getTime() - incident.createdAt.getTime()).toBe(7 * 60000);
    await db.service.update({
      where: { id: service.id },
      data: { escalationPolicyId: policies[2].id },
    });
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: false },
      update: { automationEnabled: false },
    });
    for (const command of ['ACKNOWLEDGE', 'UNACKNOWLEDGE', 'RESOLVE', 'REOPEN'] as const) {
      await db.$transaction(tx =>
        applyIncidentLifecycleCommand(tx, {
          incidentId: incident.id,
          command,
          source: 'SYSTEM',
          now: new Date(),
        })
      );
      expect((await resolveIncidentResponderRouting(incident.id, service.id)).policy?.id).toBe(
        policies[1].id
      );
    }
    expect(
      (await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).nextEscalationAt
    ).not.toBeNull();
    await expect(db.escalationPolicy.delete({ where: { id: policies[1].id } })).rejects.toThrow();
  });
  it('competing escalation workers page only the pinned audience once after the default changes', async () => {
    await createTestNotificationProvider('smtp', {
      host: '127.0.0.1',
      port: 2525,
      user: 'automation-local',
      password: 'automation-local-only',
      fromEmail: 'automation@example.com',
    });
    const selected = await createTestUser({ emailNotificationsEnabled: true });
    const defaultUser = await createTestUser({ emailNotificationsEnabled: true });
    const policies = await Promise.all(
      [selected, defaultUser].map(user =>
        db.escalationPolicy.create({
          data: {
            name: user.id,
            steps: {
              create: {
                stepOrder: 0,
                delayMinutes: 0,
                targetType: 'USER',
                targetUserId: user.id,
                notificationChannels: ['EMAIL'],
              },
            },
          },
        })
      )
    );
    const { service } = await setup({
      ...emptySnapshot,
      rules: [
        {
          id: 'selected',
          name: 'Selected audience',
          phase: 'ROUTE',
          enabled: true,
          conditions: [],
          actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policies[0].id }],
        },
      ],
    });
    await ingest(service.id);
    const incident = await db.incident.findFirstOrThrow();
    await db.service.update({
      where: { id: service.id },
      data: { escalationPolicyId: policies[1].id },
    });
    await Promise.all([executeEscalation(incident.id, 0), executeEscalation(incident.id, 0)]);
    const pages = await db.notification.findMany({
      where: { incidentId: incident.id, channel: 'EMAIL' },
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].userId).toBe(selected.id);
    expect(
      await db.inAppNotification.count({
        where: { entityId: incident.id, userId: defaultUser.id },
      })
    ).toBe(0);
  });
  it('historical pinned policies remain available for reopening after version deactivation', async () => {
    const pinned = await db.escalationPolicy.create({ data: { name: 'Pinned policy' } });
    const replacement = await db.escalationPolicy.create({ data: { name: 'New default' } });
    const { service, actor, draft, version } = await setup({
      ...emptySnapshot,
      rules: [
        {
          id: 'pinned',
          name: 'Pinned',
          phase: 'ROUTE',
          enabled: true,
          conditions: [],
          actions: [{ type: 'USE_ESCALATION_POLICY', policyId: pinned.id }],
        },
      ],
    });
    await ingest(service.id);
    const incident = await db.incident.findFirstOrThrow();
    await db.$transaction(tx =>
      applyIncidentLifecycleCommand(tx, {
        incidentId: incident.id,
        command: 'RESOLVE',
        source: 'SYSTEM',
      })
    );
    const next = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      snapshot: emptySnapshot,
      expectedRevision: draft.revision,
    });
    await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: next.revision,
      expectedActiveVersionId: version.id,
    });
    await db.service.update({
      where: { id: service.id },
      data: { escalationPolicyId: replacement.id },
    });
    await expect(db.escalationPolicy.delete({ where: { id: pinned.id } })).rejects.toThrow();
    await db.$transaction(tx =>
      applyIncidentLifecycleCommand(tx, {
        incidentId: incident.id,
        command: 'REOPEN',
        source: 'SYSTEM',
      })
    );
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'OPEN'
    );
    expect((await resolveIncidentResponderRouting(incident.id, service.id)).policy?.id).toBe(
      pinned.id
    );
  });
  it('concurrent decision insertion and policy deletion cannot leave a dangling route', async () => {
    const service = await db.service.create({ data: { name: 'Deletion race' } });
    for (let attempt = 0; attempt < 10; attempt++) {
      const policy = await db.escalationPolicy.create({ data: { name: `Race ${attempt}` } });
      const incident = await db.incident.create({
        data: { serviceId: service.id, title: 'Race', status: 'RESOLVED' },
      });
      const outcomes = await Promise.allSettled([
        db.incidentAutomationDecision.create({
          data: {
            incidentId: incident.id,
            serviceId: service.id,
            mode: 'LIVE',
            routeType: 'ESCALATION_POLICY',
            escalationPolicyId: policy.id,
            evaluationAt: new Date(),
            summary: {},
          },
        }),
        db.escalationPolicy.delete({ where: { id: policy.id } }),
      ]);
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
      const decision = await db.incidentAutomationDecision.findUnique({
        where: { incidentId: incident.id },
      });
      const retainedPolicy = await db.escalationPolicy.findUnique({ where: { id: policy.id } });
      expect(Boolean(decision)).toBe(Boolean(retainedPolicy));
      if (decision) expect(decision.escalationPolicyId).toBe(retainedPolicy!.id);
    }
  });
  it('NO_ESCALATION stays closed through reopen', async () => {
    const { service } = await setup();
    await ingest(service.id);
    const incident = await db.incident.findFirstOrThrow();
    await db.$transaction(tx =>
      applyIncidentLifecycleCommand(tx, {
        incidentId: incident.id,
        command: 'RESOLVE',
        source: 'SYSTEM',
      })
    );
    await db.$transaction(tx =>
      applyIncidentLifecycleCommand(tx, {
        incidentId: incident.id,
        command: 'REOPEN',
        source: 'SYSTEM',
      })
    );
    expect(
      (await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).nextEscalationAt
    ).toBeNull();
    expect(await db.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(0);
  });
  it('immutable version and decision rows reject updates; rollback publishes a new version', async () => {
    const { service, actor, draft, version } = await setup();
    await ingest(service.id);
    await expect(
      db.automationVersion.update({ where: { id: version.id }, data: { checksum: 'changed' } })
    ).rejects.toThrow();
    const incident = await db.incident.findFirstOrThrow();
    await expect(
      db.incidentAutomationDecision.update({
        where: { incidentId: incident.id },
        data: { routeType: 'SERVICE_DEFAULT' },
      })
    ).rejects.toThrow();
    const restored = await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: draft.revision,
      expectedActiveVersionId: version.id,
      sourceVersionId: version.id,
    });
    expect(restored.id).not.toBe(version.id);
    expect(restored.sourceVersionId).toBe(version.id);
    expect(restored.versionNumber).toBe(2);
    await expect(
      saveDraft({ serviceId: service.id, actorId: actor.id, snapshot, expectedRevision: 0 })
    ).rejects.toThrow('Another version');
  });
  it('corrupt versions fall back without enrichment or supplemental effects', async () => {
    const service = await db.service.create({ data: { name: 'Corrupt service' } });
    const version = await db.automationVersion.create({
      data: {
        serviceId: service.id,
        versionNumber: 1,
        snapshot: {},
        compiledSnapshot: {},
        checksum: checksum({ wrong: true }),
        publishedBy: 'test',
        lintReport: [],
      },
    });
    await db.serviceAutomationConfig.create({
      data: { serviceId: service.id, mode: 'LIVE', activeVersionId: version.id },
    });
    await ingest(service.id);
    const incident = await db.incident.findFirstOrThrow();
    expect(incident.priority).toBe('P2');
    expect((await db.incidentAutomationDecision.findFirstOrThrow()).fallbackReason).toBe(
      'VERSION_INVALID'
    );
    expect(await db.incidentTag.count()).toBe(0);
  });
  it('old replicas without a decision retain default routing; envelope feature-off parity', async () => {
    const service = await db.service.create({ data: { name: 'Legacy service' } });
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: false },
      update: { automationEnabled: false },
    });
    await processEvent(structuredClone(event), service.id, 'legacy');
    await ingest(service.id, { ...event, dedup_key: 'new-envelope' });
    const incidents = await db.incident.findMany();
    expect(incidents[0].priority).toBe(incidents[1].priority);
    expect(await db.incidentAutomationDecision.count()).toBe(0);
    expect((await resolveIncidentResponderRouting(incidents[0].id, service.id)).type).toBe(
      'DEFAULT_FANOUT'
    );
  });
  it('observations are bounded and idempotent under worker retry', async () => {
    const { service } = await setup();
    const job = {
      task: 'AUTOMATION_OBSERVE',
      logicalKey: 'observation-test',
      serviceId: service.id,
      integrationId: 'test',
      integrationType: 'CLOUDWATCH',
      observations: [
        { key: 'environment', path: 'environment', value: 'stg-2', type: 'ENUM', unmapped: true },
      ],
    };
    await Promise.all([processAutomationJob(job), processAutomationJob(job)]);
    expect((await db.automationContextObservation.findFirstOrThrow()).count).toBe(1);
  });
  it('rolls back incident, decision, trace, and outbox when a web transaction dies before commit', async () => {
    const { service } = await setup();
    const envelope = {
      serviceId: service.id,
      integrationId: 'cert',
      integrationType: 'EVENTS_API',
      event,
      providerPayload: event,
      receivedAt: new Date(),
    };
    await expect(
      db.$transaction(async tx => {
        const incident = await tx.incident.create({
          data: {
            title: 'Interrupted transaction',
            serviceId: service.id,
            urgency: 'HIGH',
            priority: 'P2',
          },
        });
        const evaluation = await prepareAutomation(tx, envelope, {
          priority: 'P2',
          urgency: 'HIGH',
        });
        await persistAutomation(tx, incident.id, envelope, evaluation!);
        throw new Error('simulated web failure before commit');
      })
    ).rejects.toThrow('simulated web failure');
    expect(await db.incident.count()).toBe(0);
    expect(await db.incidentAutomationDecision.count()).toBe(0);
    expect(await db.automationTrace.count()).toBe(0);
    expect(await db.backgroundJob.count()).toBe(0);
    await ingest(service.id);
    await ingest(service.id); // Lost HTTP response after commit is safe to replay.
    expect(await db.incident.count()).toBe(1);
    expect(await db.incidentAutomationDecision.count()).toBe(1);
  });
  it('publishes while alerts arrive without mixing versions inside a decision', async () => {
    const { service, actor, draft, version } = await setup();
    const updated = {
      ...snapshot,
      rules: snapshot.rules.map(rule =>
        rule.phase === 'ENRICH'
          ? { ...rule, actions: [{ type: 'SET_PRIORITY' as const, value: 'P3' as const }] }
          : rule
      ),
    };
    const saved = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      snapshot: updated,
      expectedRevision: draft.revision,
    });
    const publish = publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: saved.revision,
      expectedActiveVersionId: version.id,
    });
    await Promise.all([
      publish,
      ...Array.from({ length: 30 }, (_, i) =>
        ingest(service.id, { ...event, dedup_key: `publish-race-${i}` })
      ),
    ]);
    const next = await publish;
    const decisions = await db.incidentAutomationDecision.findMany();
    expect(decisions).toHaveLength(30);
    for (const decision of decisions) {
      expect([version.id, next.id]).toContain(decision.versionId);
      expect(decision.finalPriority).toBe(decision.versionId === version.id ? 'P1' : 'P3');
      expect(decision.routeType).toBe('NO_ESCALATION');
    }
  });
  it('two general workers claim disjoint jobs and expired claims replay observations safely', async () => {
    const { service } = await setup();
    await ingest(service.id);
    const [first, second] = await Promise.all([
      claimPendingJobs(50, undefined, GENERAL_WORKER_EXCLUDED_JOB_TYPES),
      claimPendingJobs(50, undefined, GENERAL_WORKER_EXCLUDED_JOB_TYPES),
    ]);
    const jobs = [...first, ...second];
    expect(new Set(jobs.map(job => job.id)).size).toBe(jobs.length);
    const observation = jobs.find(
      job => (job.payload as { task: string }).task === 'AUTOMATION_OBSERVE'
    )!;
    expect(observation).toBeTruthy();
    await processAutomationJob(observation.payload); // Worker commits observation, then dies before job completion.
    await db.backgroundJob.update({
      where: { id: observation.id },
      data: { startedAt: new Date(Date.now() - 11 * 60000) },
    });
    const reclaimed = await claimPendingJobs(50, undefined, GENERAL_WORKER_EXCLUDED_JOB_TYPES);
    expect(reclaimed.some(job => job.id === observation.id)).toBe(true);
    await processJob(reclaimed.find(job => job.id === observation.id)!);
    expect(
      (
        await db.automationContextObservation.findFirstOrThrow({
          where: { fieldKey: 'environment' },
        })
      ).count
    ).toBe(1);
    expect(await db.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(0);
  });
  it('NO_ESCALATION delivers one supplemental Slack intent under retries and no personal intent', async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    const { service, actor, draft, version } = await setup();
    const destination = await db.slackDestination.create({
      data: { serviceId: service.id, workspaceId: 'test-workspace', channelId: 'C_TEST' },
    });
    const updated = {
      ...snapshot,
      rules: snapshot.rules.map(rule =>
        rule.phase === 'ROUTE'
          ? {
              ...rule,
              actions: [
                ...rule.actions,
                {
                  type: 'NOTIFY_CHANNEL' as const,
                  provider: 'SLACK' as const,
                  destinationId: destination.id,
                },
              ],
            }
          : rule
      ),
    };
    const saved = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      snapshot: updated,
      expectedRevision: draft.revision,
    });
    await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: saved.revision,
      expectedActiveVersionId: version.id,
    });
    await ingest(service.id);
    const job = await db.backgroundJob.findFirstOrThrow({
      where: { payload: { path: ['task'], equals: 'AUTOMATION_NOTIFY' } },
    });
    await Promise.all(Array.from({ length: 10 }, () => processAutomationJob(job.payload)));
    const notifications = await db.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].channel).toBe('SLACK');
    expect(notifications[0].recipientType).toBe('SLACK_CHANNEL');
    expect(await db.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(0);
  });
  it('bounds observation cardinality per field while continuing existing-value counts', async () => {
    const { service } = await setup();
    const base = {
      task: 'AUTOMATION_OBSERVE',
      serviceId: service.id,
      integrationId: 'cardinality',
      integrationType: 'EVENTS_API',
    };
    for (let batch = 0; batch < 5; batch++)
      await processAutomationJob({
        ...base,
        logicalKey: `bounded-${batch}`,
        observations: Array.from({ length: 60 }, (_, index) => ({
          key: 'environment',
          path: 'environment',
          value: `unknown-${batch * 60 + index}`,
          type: 'ENUM',
          unmapped: true,
        })),
      });
    expect(await db.automationContextObservation.count()).toBe(256);
    await processAutomationJob({
      ...base,
      logicalKey: 'existing-value',
      observations: [
        {
          key: 'environment',
          path: 'environment',
          value: 'unknown-0',
          type: 'ENUM',
          unmapped: true,
        },
      ],
    });
    expect(
      (
        await db.automationContextObservation.findFirstOrThrow({
          where: { rawValuePreview: 'unknown-0' },
        })
      ).count
    ).toBe(2);
  });
  it('rejects credential-bearing builtin source values without persisting them in automation diagnostics', async () => {
    const { service } = await setup();
    await ingest(service.id, {
      ...event,
      payload: { ...event.payload, source: 'https://monitor.internal/?token=never-persist-me' },
    });
    const decision = await db.incidentAutomationDecision.findFirstOrThrow();
    expect(decision.fallbackReason).toBe('EXTRACTION_LIMIT');
    expect(decision.routeType).toBe('SERVICE_DEFAULT');
    const trace = await db.automationTrace.findFirstOrThrow();
    expect(JSON.stringify(trace.detail)).not.toContain('never-persist-me');
    expect(JSON.stringify(decision.summary)).not.toContain('never-persist-me');
  });
});
