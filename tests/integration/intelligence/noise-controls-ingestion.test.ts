import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processEvent, type EventPayload } from '@/lib/events';
import { normalizeAlertShape } from '@/lib/alerts/normalization';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  beginIngestNoiseLookups,
  evaluateIngestNoiseControls,
} from '@/lib/intelligence/ingest-hooks';
import { setIngestNoisePrefetch } from '@/lib/intelligence/noise-controls/ingest';
import { NOISE_CONTROL_REVERSAL_INTEGRATION_ID } from '@/lib/intelligence/noise-controls/decisions';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  reversePrePagingDecision,
  setPrePagingDeadlineMs,
  type PrePagingInput,
} from '@/lib/intelligence/noise-controls';
import {
  disconnectNoiseLookupClient,
  setNoiseLookupRoute,
} from '@/lib/intelligence/noise-controls/lookup-client';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/**
 * The pre-paging noise controls wired into live ingestion: OFF / SHADOW / ON for every control, what an
 * applied decision does to the incident and its paging, reversal paging again, and fail-open.
 */

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
  // Functional assertions must not depend on this host's round-trip time; the production 5 ms default
  // is exercised by the fail-open tests below and by the ingestion suite.
  setPrePagingDeadlineMs(50);
  await resetDatabase();
});
afterEach(() => setIngestNoisePrefetch(null));
afterAll(async () => {
  setPrePagingDeadlineMs(null);
  setNoiseLookupRoute(null);
  await disconnectNoiseLookupClient();
});

type Mode = 'OFF' | 'SHADOW' | 'ON';

async function setup(name = 'Checkout') {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  const service = await createTestService(name);
  return { admin, service, actor: { actorId: admin.id, source: 'UI' as const } };
}

async function policy(serviceId: string, mode: Mode, definition: Record<string, unknown> = {}) {
  await db.noiseControlPolicy.upsert({
    where: { scopeKey: `service:${serviceId}` },
    update: { mode, definition: { schemaVersion: 1, ...definition } as Prisma.InputJsonObject },
    create: {
      scopeKey: `service:${serviceId}`,
      serviceId,
      mode,
      definition: { schemaVersion: 1, ...definition } as Prisma.InputJsonObject,
    },
  });
  await primePrePagingSnapshot();
}

async function window(serviceId: string, effect: 'SUPPRESS' | 'DOWNGRADE' = 'SUPPRESS') {
  const now = Date.now();
  return db.maintenanceWindow.create({
    data: {
      name: 'Patching',
      scope: 'SERVICE',
      serviceId,
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + 3_600_000),
      effect,
      downgradeUrgency: effect === 'DOWNGRADE' ? 'LOW' : null,
    },
  });
}

let sequence = 0;
function event(overrides: Partial<EventPayload['payload']> = {}, dedup?: string): EventPayload {
  sequence += 1;
  return {
    event_action: 'trigger',
    dedup_key: dedup ?? `noise-${sequence}-${Math.random().toString(36).slice(2, 8)}`,
    payload: {
      summary: 'Checkout pool exhausted',
      source: 'prometheus',
      severity: 'error',
      ...overrides,
    },
  };
}

const ingest = (serviceId: string, payload: EventPayload = event()) =>
  processEvent(payload, serviceId, 'noise-it');

function incidentOf(result: Awaited<ReturnType<typeof processEvent>>) {
  if (!('incident' in result) || !result.incident) throw new Error('expected an incident');
  return result.incident;
}

/** The responder page: the durable escalation-notification job committed with the incident. */
async function pagingJobs(incidentId: string) {
  return db.backgroundJob.findMany({
    where: {
      AND: [
        { payload: { path: ['incidentId'], equals: incidentId } },
        { payload: { path: ['effect'], equals: 'TRIGGER_ESCALATION_NOTIFICATIONS' } },
      ],
    },
    select: { scheduledAt: true },
  });
}

const decisions = (serviceId: string) =>
  db.prePagingDecision.findMany({ where: { serviceId }, orderBy: { createdAt: 'asc' } });

async function events(incidentId: string) {
  return (
    await db.incidentEvent.findMany({ where: { incidentId }, orderBy: { createdAt: 'asc' } })
  ).map(row => row.message);
}

describe('OFF (default)', () => {
  it('pages normally and records nothing, with or without an OFF policy and matching controls', async () => {
    const { service } = await setup();
    await window(service.id);
    await primePrePagingSnapshot();
    const plain = incidentOf(await ingest(service.id));
    expect(plain.status).toBe('OPEN');
    expect(await pagingJobs(plain.id)).toHaveLength(1);

    await policy(service.id, 'OFF', {
      contentDedup: { enabled: true },
      flapping: { enabled: true },
      storm: { enabled: true, threshold: 2 },
    });
    const again = incidentOf(await ingest(service.id));
    expect(again.status).toBe('OPEN');
    expect(await pagingJobs(again.id)).toHaveLength(1);
    expect(await decisions(service.id)).toEqual([]);
  });

  it('a service switched OFF does not inherit an active global policy', async () => {
    const { service } = await setup();
    await window(service.id);
    await db.noiseControlPolicy.create({
      data: { scopeKey: 'global', mode: 'ON', definition: { schemaVersion: 1 } },
    });
    await policy(service.id, 'OFF');
    const result = incidentOf(await ingest(service.id));
    expect(result.status).toBe('OPEN');
    expect(await decisions(service.id)).toEqual([]);
  });
});

describe('maintenance windows and suppression rules', () => {
  it('SHADOW records the decision and pages normally', async () => {
    const { service } = await setup();
    const maintenance = await window(service.id);
    await policy(service.id, 'SHADOW');
    const result = await ingest(service.id);
    const incident = incidentOf(result);
    expect(result.action).toBe('triggered');
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
    expect(await decisions(service.id)).toMatchObject([
      {
        control: 'MAINTENANCE',
        action: 'SUPPRESS',
        mode: 'SHADOW',
        applied: false,
        sourceId: maintenance.id,
        incidentId: incident.id,
        alertId: expect.any(String),
      },
    ]);
  });

  it('ON suppresses (stored, visible, never pages) and reversing the decision pages', async () => {
    const { service, actor } = await setup();
    await window(service.id);
    await policy(service.id, 'ON');
    const result = await ingest(service.id);
    const incident = incidentOf(result);
    expect(result.action).toBe('suppressed');
    expect(incident).toMatchObject({ status: 'SUPPRESSED', escalationStatus: 'COMPLETED' });
    expect(await pagingJobs(incident.id)).toHaveLength(0);
    expect((await events(incident.id))[0]).toMatch(
      /SUPPRESSED state by noise control \(MAINTENANCE\).*In maintenance window "Patching".*reverse the decision/
    );
    const [decision] = await decisions(service.id);
    expect(decision).toMatchObject({ applied: true, mode: 'ON', incidentId: incident.id });
    expect(await db.alert.count({ where: { incidentId: incident.id } })).toBe(1);

    const reversal = await reversePrePagingDecision(decision.id, actor);
    if (reversal.outcome !== 'reversed' || !reversal.incidentId)
      throw new Error('expected a re-ingested incident');
    // The re-ingest bypasses the controls even though the window is still active.
    const paged = await db.incident.findUniqueOrThrow({ where: { id: reversal.incidentId } });
    expect(paged.status).toBe('OPEN');
    expect(await pagingJobs(paged.id)).toHaveLength(1);
    expect(await decisions(service.id)).toHaveLength(1);
  });

  it('ON downgrades urgency through a window or a rule and explains it on the timeline', async () => {
    const { service } = await setup();
    await window(service.id, 'DOWNGRADE');
    await policy(service.id, 'ON');
    const incident = incidentOf(await ingest(service.id));
    expect(incident.urgency).toBe('LOW');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
    expect((await events(incident.id)).join('\n')).toMatch(
      /Urgency lowered from \w+ to LOW by noise control \(MAINTENANCE\)/
    );

    const other = await createTestService('Payments');
    await db.suppressionRule.create({
      data: {
        name: 'Noisy probe',
        serviceId: other.id,
        matchers: [{ field: 'source', op: 'equals', value: 'probe' }],
        effect: 'SUPPRESS',
      },
    });
    await policy(other.id, 'ON');
    const suppressed = await ingest(other.id, event({ source: 'probe' }));
    expect(suppressed.action).toBe('suppressed');
    const unmatched = await ingest(other.id, event({ source: 'prometheus' }));
    expect(unmatched.action).toBe('triggered');
    expect(await decisions(other.id)).toMatchObject([
      { control: 'SUPPRESSION', action: 'SUPPRESS', applied: true },
    ]);
  });
});

describe('orchestration', () => {
  const rules = {
    orchestration: {
      rules: [
        {
          id: 'drop-debug',
          name: 'Drop debug',
          conditions: [{ field: 'summary', op: 'prefix', value: 'debug' }],
          actions: [{ type: 'DROP' }],
        },
        {
          id: 'tag-db',
          name: 'Tag database',
          conditions: [{ field: 'source', op: 'equals', value: 'pgwatch' }],
          actions: [
            { type: 'SET_URGENCY', value: 'LOW' },
            { type: 'SET_SEVERITY', value: 'info' },
            { type: 'SET_LABEL', key: 'team', value: 'dba' },
            { type: 'ADD_NOTE', text: 'Check replication lag first' },
            { type: 'ATTACH_RUNBOOK', runbookId: 'rb-1' },
          ],
        },
      ],
    },
  };

  it('ON drops (alert kept unlinked, no incident) and reversing pages; transforms restate the alert', async () => {
    const { service, actor } = await setup();
    await policy(service.id, 'ON', rules);
    const dropped = await ingest(service.id, event({ summary: 'debug heartbeat' }));
    expect(dropped).toMatchObject({ action: 'dropped' });
    expect(await db.incident.count({ where: { serviceId: service.id } })).toBe(0);
    const [decision] = await decisions(service.id);
    expect(decision).toMatchObject({ control: 'ORCHESTRATION', action: 'DROP', applied: true });
    const alert = await db.alert.findUniqueOrThrow({ where: { id: decision.alertId! } });
    expect(alert.incidentId).toBeNull();

    const reversal = await reversePrePagingDecision(decision.id, actor);
    if (reversal.outcome !== 'reversed' || !reversal.incidentId) throw new Error('expected a page');
    expect(await pagingJobs(reversal.incidentId)).toHaveLength(1);

    const transformed = incidentOf(await ingest(service.id, event({ source: 'pgwatch' })));
    expect(transformed.urgency).toBe('LOW');
    const stored = await db.alert.findFirstOrThrow({ where: { incidentId: transformed.id } });
    expect(stored.severity).toBe('info');
    expect(stored.labels).toMatchObject({ team: 'dba' });
    const timeline = (await events(transformed.id)).join('\n');
    expect(timeline).toMatch(/Orchestration rules set severity info; urgency LOW; labels team/);
    expect(timeline).toMatch(/Orchestration note: Check replication lag first/);
    expect(timeline).toMatch(/attach runbook rb-1; not applied at ingestion/);
    expect(await pagingJobs(transformed.id)).toHaveLength(1);
  });

  it('SHADOW records a would-be drop and still creates and pages the incident', async () => {
    const { service } = await setup();
    await policy(service.id, 'SHADOW', rules);
    const result = await ingest(service.id, event({ summary: 'debug heartbeat' }));
    const incident = incidentOf(result);
    expect(await pagingJobs(incident.id)).toHaveLength(1);
    expect(await decisions(service.id)).toMatchObject([
      { action: 'DROP', mode: 'SHADOW', applied: false, incidentId: incident.id },
    ]);
  });
});

describe('content dedup', () => {
  const definition = { contentDedup: { enabled: true, windowSeconds: 900 } };

  it('ON appends to the open incident with the same content; reversing pages it on its own', async () => {
    const { service, actor } = await setup();
    const first = incidentOf(await ingest(service.id));
    await policy(service.id, 'ON', definition);
    const second = await ingest(service.id, event());
    expect(second.action).toBe('deduplicated');
    expect(incidentOf(second).id).toBe(first.id);
    expect(await db.incident.count({ where: { serviceId: service.id } })).toBe(1);
    expect(await db.alert.count({ where: { incidentId: first.id } })).toBe(2);
    expect((await events(first.id)).join('\n')).toMatch(
      /appended by noise control \(CONTENT_DEDUP\)/
    );
    const [decision] = await decisions(service.id);
    expect(decision).toMatchObject({ action: 'APPEND', applied: true, incidentId: first.id });

    const reversal = await reversePrePagingDecision(decision.id, actor);
    if (reversal.outcome !== 'reversed' || !reversal.incidentId) throw new Error('expected a page');
    expect(reversal.incidentId).not.toBe(first.id);
    expect(await pagingJobs(reversal.incidentId)).toHaveLength(1);
  });

  it('SHADOW keeps both incidents and records the would-be target', async () => {
    const { service } = await setup();
    const first = incidentOf(await ingest(service.id));
    await policy(service.id, 'SHADOW', definition);
    const second = incidentOf(await ingest(service.id, event()));
    expect(second.id).not.toBe(first.id);
    expect(await pagingJobs(second.id)).toHaveLength(1);
    const [decision] = await decisions(service.id);
    expect(decision).toMatchObject({ action: 'APPEND', applied: false, incidentId: second.id });
    expect(decision.evidence).toMatchObject({ targetIncidentId: first.id });
  });

  it('leaves HIGH urgency alone unless the policy opts in', async () => {
    const { service } = await setup();
    incidentOf(await ingest(service.id, event({ severity: 'critical' })));
    await policy(service.id, 'ON', definition);
    const high = await ingest(service.id, event({ severity: 'critical' }));
    expect(incidentOf(high).urgency).toBe('HIGH');
    expect(high.action).toBe('triggered');
    await policy(service.id, 'ON', { ...definition, allowHighUrgency: true });
    expect((await ingest(service.id, event({ severity: 'critical' }))).action).toBe('deduplicated');
  });
});

describe('flapping', () => {
  it('OFF/SHADOW/ON on a fingerprint that keeps changing state', async () => {
    const { service } = await setup();
    const summary = 'Disk latency on db-7';
    const fingerprintHash = normalizeAlertShape({ summary }).fingerprintHash;
    const now = Date.now();
    await db.alert.createMany({
      data: ['TRIGGERED', 'RESOLVED', 'TRIGGERED', 'RESOLVED'].map((status, i) => ({
        serviceId: service.id,
        dedupKey: `rotating-${i}`,
        fingerprintHash,
        status,
        payload: {},
        createdAt: new Date(now - (i + 1) * 5_000),
      })),
    });
    const definition = { flapping: { enabled: true, threshold: 3, windowSeconds: 180 } };

    await policy(service.id, 'OFF', definition);
    expect((await ingest(service.id, event({ summary }))).action).toBe('triggered');
    await policy(service.id, 'SHADOW', definition);
    expect((await ingest(service.id, event({ summary }))).action).toBe('triggered');
    await policy(service.id, 'ON', definition);
    const flapping = await ingest(service.id, event({ summary }));
    expect(flapping.action).toBe('suppressed');
    expect(await pagingJobs(incidentOf(flapping).id)).toHaveLength(0);
    expect(await decisions(service.id)).toMatchObject([
      { control: 'FLAPPING', action: 'SUPPRESS', mode: 'SHADOW', applied: false },
      { control: 'FLAPPING', action: 'SUPPRESS', mode: 'ON', applied: true },
    ]);
  });
});

describe('storm grouping', () => {
  it('ON groups children under the earliest open incident: the storm pages once', async () => {
    const { service, actor } = await setup();
    await policy(service.id, 'ON', { storm: { enabled: true, threshold: 2, windowSeconds: 60 } });
    const parent = incidentOf(await ingest(service.id, event({ summary: 'API 5xx on edge-1' })));
    const second = incidentOf(await ingest(service.id, event({ summary: 'API 5xx on edge-2' })));
    expect(await pagingJobs(second.id)).toHaveLength(1);
    const children = [];
    for (const n of [3, 4, 5]) {
      const result = await ingest(service.id, event({ summary: `API 5xx on edge-${n}` }));
      expect(result.action).toBe('grouped');
      children.push(incidentOf(result));
    }
    for (const child of children) {
      expect(child).toMatchObject({ status: 'OPEN', escalationStatus: 'COMPLETED' });
      expect(await pagingJobs(child.id)).toHaveLength(0);
      expect((await events(child.id))[0]).toMatch(/grouped under storm parent/);
    }
    expect(await pagingJobs(parent.id)).toHaveLength(1);
    const links = await db.incidentRelationship.findMany({
      where: { targetIncidentId: parent.id, type: 'PARENT_CHILD' },
    });
    expect(links.map(link => link.sourceIncidentId).sort()).toEqual(
      children.map(child => child.id).sort()
    );
    expect(links.every(link => link.decision === 'ACCEPTED' && link.origin === 'RULE')).toBe(true);
    expect(
      (await events(parent.id)).filter(message => message.startsWith('Storm child grouped'))
    ).toHaveLength(3);
    // Each child still queues its service-channel post (which rolls up), never a responder page.
    const childJobs = await db.backgroundJob.findMany({
      where: { payload: { path: ['incidentId'], equals: children[0].id } },
      select: { payload: true },
    });
    expect(
      childJobs.map(job => (job.payload as { effect?: string }).effect).filter(Boolean)
    ).not.toContain('TRIGGER_ESCALATION_NOTIFICATIONS');

    const [decision] = (await decisions(service.id)).filter(row => row.action === 'GROUP_CHILD');
    const reversal = await reversePrePagingDecision(decision.id, actor);
    if (reversal.outcome !== 'reversed' || !reversal.incidentId) throw new Error('expected a page');
    expect(await pagingJobs(reversal.incidentId)).toHaveLength(1);
  });

  it('SHADOW pages every incident and records the would-be grouping', async () => {
    const { service } = await setup();
    await policy(service.id, 'SHADOW', {
      storm: { enabled: true, threshold: 2, windowSeconds: 60 },
    });
    const created = [];
    for (let i = 0; i < 3; i += 1) created.push(incidentOf(await ingest(service.id)));
    for (const incident of created) expect(await pagingJobs(incident.id)).toHaveLength(1);
    expect(await decisions(service.id)).toMatchObject([
      { control: 'STORM', action: 'GROUP_CHILD', mode: 'SHADOW', applied: false },
    ]);
    expect(await db.incidentRelationship.count()).toBe(0);
  });

  it('ON holds a forming burst for a bounded time but never holds HIGH urgency', async () => {
    const { service } = await setup();
    await policy(service.id, 'ON', {
      storm: { enabled: true, threshold: 4, windowSeconds: 60, holdSeconds: 30 },
    });
    await ingest(service.id);
    await ingest(service.id);
    const before = Date.now();
    const held = incidentOf(await ingest(service.id));
    const [heldJob] = await pagingJobs(held.id);
    expect(heldJob.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 29_000);
    expect(heldJob.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 31_000);
    expect((await events(held.id)).join('\n')).toMatch(/Paging held until .* \(STORM\)/);

    const high = incidentOf(await ingest(service.id, event({ severity: 'critical' })));
    expect(high.urgency).toBe('HIGH');
    const [highJob] = await pagingJobs(high.id);
    expect(highJob.scheduledAt.getTime()).toBeLessThan(Date.now() + 5_000);

    // Even with the HIGH opt-in, a hold is never applied to HIGH.
    await policy(service.id, 'ON', {
      allowHighUrgency: true,
      storm: { enabled: true, threshold: 40, windowSeconds: 60, holdSeconds: 30 },
    });
    const optedIn = incidentOf(await ingest(service.id, event({ severity: 'critical' })));
    const [optedInJob] = await pagingJobs(optedIn.id);
    expect(optedInJob.scheduledAt.getTime()).toBeLessThan(Date.now() + 5_000);
  });

  it('rolls storm children’s notifications up under the parent through the noise controller', async () => {
    const { service } = await setup();
    const base = {
      category: 'INCIDENT' as const,
      channel: 'WEBHOOK' as const,
      recipientType: 'WEBHOOK' as const,
      recipientId: service.id,
      recipientAddress: 'https://hooks.example.test/opsknight',
      templateKey: 'legacy-service-webhook-triggered',
      sourceType: 'SERVICE_INCIDENT',
      trafficClass: 'CRITICAL' as const,
      displayMessage: 'triggered',
      payload: {
        kind: 'WEBHOOK' as const,
        url: 'https://hooks.example.test/opsknight',
        payload: {},
      },
    };
    const parent = await createCentralNotificationIntent({
      ...base,
      sourceId: `${service.id}:parent-1`,
      eventKey: 'parent-1',
    });
    const children = [];
    for (const n of [1, 2, 3])
      children.push(
        await createCentralNotificationIntent({
          ...base,
          sourceId: `${service.id}:parent-1`,
          eventKey: `child-${n}`,
          rollUpParentId: 'parent-1',
        })
      );
    const rows = await db.notification.findMany({
      where: { id: { in: [parent.id, ...children.map(child => child.id)] } },
      select: { id: true, status: true, errorMsg: true },
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    expect(byId.get(parent.id)?.status).toBe('PENDING');
    for (const child of children)
      expect(byId.get(child.id)).toMatchObject({
        status: 'SKIPPED',
        errorMsg: 'Rolled up under parent incident parent-1',
      });

    // Without a recent parent post, the first child is delivered once as a grouped post.
    const lone = await createCentralNotificationIntent({
      ...base,
      sourceId: `${service.id}:parent-2`,
      eventKey: 'lone-1',
      rollUpParentId: 'parent-2',
    });
    const next = await createCentralNotificationIntent({
      ...base,
      sourceId: `${service.id}:parent-2`,
      eventKey: 'lone-2',
      rollUpParentId: 'parent-2',
    });
    expect(await db.notification.findUniqueOrThrow({ where: { id: lone.id } })).toMatchObject({
      status: 'PENDING',
      message: expect.stringMatching(/^Grouped notification/),
    });
    expect((await db.notification.findUniqueOrThrow({ where: { id: next.id } })).status).toBe(
      'SKIPPED'
    );
  });
});

describe('fail-open', () => {
  function input(serviceId: string): PrePagingInput {
    return {
      serviceId,
      source: 'prometheus',
      summary: 'Checkout pool exhausted',
      severity: 'error',
      urgency: 'MEDIUM',
      labels: {},
      resourceKey: null,
      fingerprintHash: 'fp',
      dedupKey: 'k',
      receivedAt: new Date(),
    };
  }

  it('a throwing or hanging hook returns null (page normally) within the deadline', async () => {
    const { service } = await setup();
    await policy(service.id, 'ON', { storm: { enabled: true, threshold: 2 } });
    const snapshot = await primePrePagingSnapshot();
    const throwing = {
      findOpenIncidentByFingerprint: async () => null,
      countRecentIncidents: async () => {
        throw new Error('connection reset');
      },
      findStormParent: async () => null,
      recentAlertStatuses: async () => [],
    };
    await db.$transaction(async tx => {
      expect(
        await evaluateIngestNoiseControls(tx, input(service.id), {
          integrationId: 'x',
          snapshot,
          lookups: throwing,
        })
      ).toBeNull();
      const hanging = {
        ...throwing,
        countRecentIncidents: () => new Promise<number>(() => undefined),
      };
      const started = performance.now();
      expect(
        await evaluateIngestNoiseControls(tx, input(service.id), {
          integrationId: 'x',
          snapshot,
          lookups: hanging,
          deadlineMs: 5,
        })
      ).toBeNull();
      expect(performance.now() - started).toBeLessThan(250);
    });
  });

  it('OFF and a cold cache never touch the transaction', async () => {
    const { service } = await setup();
    await policy(service.id, 'OFF', { storm: { enabled: true } });
    const snapshot = await primePrePagingSnapshot();
    const untouchable = new Proxy({} as Prisma.TransactionClient, {
      get() {
        throw new Error('the hook must not use the transaction');
      },
    });
    const lookups = {
      findOpenIncidentByFingerprint: () => Promise.reject(new Error('no lookups when OFF')),
      countRecentIncidents: () => Promise.reject(new Error('no lookups when OFF')),
      findStormParent: () => Promise.reject(new Error('no lookups when OFF')),
      recentAlertStatuses: () => Promise.reject(new Error('no lookups when OFF')),
    };
    expect(
      await evaluateIngestNoiseControls(untouchable, input(service.id), {
        integrationId: 'x',
        snapshot,
        lookups,
      })
    ).toBeNull();
    expect(
      await evaluateIngestNoiseControls(untouchable, input(service.id), {
        integrationId: 'x',
        snapshot: null,
      })
    ).toBeNull();
  });

  it('a cold cache pages normally even when an ON window matches, then applies once loaded', async () => {
    const { service } = await setup();
    await window(service.id);
    await policy(service.id, 'ON');
    resetPrePagingSnapshot();
    const cold = await ingest(service.id);
    expect(cold.action).toBe('triggered');
    expect(await pagingJobs(incidentOf(cold).id)).toHaveLength(1);
    await primePrePagingSnapshot();
    expect((await ingest(service.id)).action).toBe('suppressed');
  });

  describe.each(['pool', 'transaction'] as const)('lookups on the %s route', route => {
    beforeEach(() => {
      setNoiseLookupRoute(route);
    });
    afterEach(() => {
      setNoiseLookupRoute(null);
    });

    it('a failing lookup (missing table) fails open and the event pages', async () => {
      const { service } = await setup();
      incidentOf(await ingest(service.id));
      await policy(service.id, 'ON', {
        contentDedup: { enabled: true, requireLabelSubset: false },
        storm: { enabled: true, threshold: 1_000 },
      });
      await db.$executeRawUnsafe(
        'ALTER TABLE "IncidentFingerprint" RENAME TO "IncidentFingerprint_x"'
      );
      try {
        const result = await ingest(service.id);
        expect(result.action).toBe('triggered');
        expect(await pagingJobs(incidentOf(result).id)).toHaveLength(1);
        expect(await decisions(service.id)).toEqual([]);
      } finally {
        await db.$executeRawUnsafe(
          'ALTER TABLE "IncidentFingerprint_x" RENAME TO "IncidentFingerprint"'
        );
      }
    });

    it('a blocked lookup is cut off by the server-side deadline and the event pages promptly', async () => {
      setPrePagingDeadlineMs(null);
      const { service } = await setup();
      incidentOf(await ingest(service.id));
      await policy(service.id, 'ON', {
        contentDedup: { enabled: true, requireLabelSubset: false },
      });
      let release: () => void = () => undefined;
      const locked = new Promise<void>(resolve => {
        release = resolve;
      });
      let held: () => void = () => undefined;
      const holding = new Promise<void>(resolve => {
        held = resolve;
      });
      const blocker = db.$transaction(
        async tx => {
          await tx.$executeRawUnsafe('LOCK TABLE "IncidentFingerprint" IN ACCESS EXCLUSIVE MODE');
          held();
          await locked;
        },
        { timeout: 30_000 }
      );
      await holding;
      try {
        const started = performance.now();
        const result = await ingest(service.id);
        const elapsed = performance.now() - started;
        expect(result.action).toBe('triggered');
        expect(await decisions(service.id)).toEqual([]);
        // Bounded by the deadline (plus normal ingestion work), not by the 30 s lock.
        expect(elapsed).toBeLessThan(5_000);
      } finally {
        release();
        await blocker;
      }
      expect(
        await pagingJobs(
          (await db.incident.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).id
        )
      ).toHaveLength(1);
    });
  });

  it('on the pool route SHADOW and ON lookups never touch the event transaction', async () => {
    const { service } = await setup();
    incidentOf(await ingest(service.id));
    await policy(service.id, 'ON', {
      contentDedup: { enabled: true, requireLabelSubset: false },
      storm: { enabled: true, threshold: 1_000 },
    });
    const snapshot = await primePrePagingSnapshot();
    const untouchable = new Proxy({} as Prisma.TransactionClient, {
      get() {
        throw new Error('the pool route must not use the event transaction');
      },
    });
    const { fingerprintHash } = await db.alert.findFirstOrThrow({
      where: { serviceId: service.id },
      select: { fingerprintHash: true },
    });
    const decision = await evaluateIngestNoiseControls(
      untouchable,
      { ...input(service.id), fingerprintHash },
      { integrationId: 'x', snapshot }
    );
    expect(decision).toMatchObject({ control: 'CONTENT_DEDUP', action: 'APPEND', apply: true });
  });
});

describe('early lookups (pool route)', () => {
  function input(serviceId: string, fingerprintHash: string | null = 'fp'): PrePagingInput {
    return {
      serviceId,
      source: 'prometheus',
      summary: 'Checkout pool exhausted',
      severity: 'error',
      urgency: 'MEDIUM',
      labels: {},
      resourceKey: null,
      fingerprintHash,
      dedupKey: 'k',
      receivedAt: new Date(),
    };
  }
  const untouchable = new Proxy({} as Prisma.TransactionClient, {
    get() {
      throw new Error('the pool route must not use the event transaction');
    },
  });

  it('starts nothing for OFF, a cold cache, a reversal, no lookup control or the savepoint route', async () => {
    const { service } = await setup();
    const begin = (integrationId = 'x') =>
      beginIngestNoiseLookups(input(service.id), { integrationId });
    expect(begin()).toBeNull(); // no policy

    await policy(service.id, 'OFF', { storm: { enabled: true } });
    expect(begin()).toBeNull();

    await policy(service.id, 'ON', {}); // ON, but nothing that reads
    expect(begin()).toBeNull();

    await policy(service.id, 'ON', { storm: { enabled: true, threshold: 1_000 } });
    expect(begin(NOISE_CONTROL_REVERSAL_INTEGRATION_ID)).toBeNull();
    setNoiseLookupRoute('transaction');
    expect(begin()).toBeNull();
    setNoiseLookupRoute(null);
    setIngestNoisePrefetch(false);
    expect(begin()).toBeNull();
    setIngestNoisePrefetch(null);
    expect(begin()).not.toBeNull();

    resetPrePagingSnapshot();
    expect(begin()).toBeNull(); // cold cache
  });

  it('the hook reuses the started lookups and decides exactly as it does without them', async () => {
    const { service } = await setup();
    incidentOf(await ingest(service.id));
    await policy(service.id, 'ON', {
      contentDedup: { enabled: true, requireLabelSubset: false },
      storm: { enabled: true, threshold: 1_000 },
    });
    const snapshot = await primePrePagingSnapshot();
    const { fingerprintHash } = await db.alert.findFirstOrThrow({
      where: { serviceId: service.id },
      select: { fingerprintHash: true },
    });
    const event = input(service.id, fingerprintHash);
    const plain = await evaluateIngestNoiseControls(untouchable, event, {
      integrationId: 'x',
      snapshot,
    });

    const prefetch = beginIngestNoiseLookups(event, { integrationId: 'x' });
    expect(prefetch).not.toBeNull();
    // Let the statement finish, then make any further read impossible: the hook must not need one.
    await prefetch!.lookups.countRecentIncidents(
      [service.id],
      new Date(event.receivedAt.getTime() - 60_000)
    );
    await disconnectNoiseLookupClient();
    setNoiseLookupRoute('transaction');
    const early = await evaluateIngestNoiseControls(untouchable, event, {
      integrationId: 'x',
      snapshot,
      prefetch,
    });
    setNoiseLookupRoute(null);
    expect(early).toMatchObject({ control: 'CONTENT_DEDUP', action: 'APPEND', apply: true });
    expect({ ...early, elapsedMs: 0 }).toEqual({ ...plain, elapsedMs: 0 });
  });

  it('ignores lookups started for another event, instant or snapshot', async () => {
    const { service } = await setup();
    await policy(service.id, 'ON', { storm: { enabled: true, threshold: 2 } });
    const snapshot = await primePrePagingSnapshot();
    const event = input(service.id);
    const poisoned = () => {
      const prefetch = beginIngestNoiseLookups(event, { integrationId: 'x' })!;
      return {
        ...prefetch,
        lookups: new Proxy(prefetch.lookups, {
          get() {
            throw new Error('a prefetch that does not match the event must not be read');
          },
        }),
      };
    };
    const evaluate = (
      prefetch: ReturnType<typeof poisoned>,
      changed: Partial<PrePagingInput> = {}
    ) =>
      evaluateIngestNoiseControls(
        untouchable,
        { ...event, ...changed },
        { integrationId: 'x', snapshot, prefetch }
      );
    // Each mismatch falls back to the hook's own lookup, which finds no storm (no incidents yet): null.
    expect(await evaluate(poisoned(), { dedupKey: 'other' })).toBeNull();
    expect(await evaluate(poisoned(), { fingerprintHash: 'other' })).toBeNull();
    expect(
      await evaluate(poisoned(), { receivedAt: new Date(event.receivedAt.getTime() + 1) })
    ).toBeNull();
    const stale = poisoned();
    const fresh = await primePrePagingSnapshot();
    expect(fresh).not.toBe(snapshot);
    expect(
      await evaluateIngestNoiseControls(untouchable, event, {
        integrationId: 'x',
        snapshot: fresh,
        prefetch: stale,
      })
    ).toBeNull();
  });

  it('the deadline counts from the moment the lookups were sent', async () => {
    const { service } = await setup();
    await policy(service.id, 'ON', { storm: { enabled: true, threshold: 2 } });
    const snapshot = await primePrePagingSnapshot();
    const event = input(service.id);
    const prefetch = beginIngestNoiseLookups(event, { integrationId: 'x' })!;
    const hanging = {
      ...prefetch,
      // Sent a full deadline ago and still unanswered: nothing is left to wait for.
      startedAt: performance.now() - prefetch.deadlineMs,
      lookups: {
        ...prefetch.lookups,
        countRecentIncidents: () => new Promise<number>(() => undefined),
      },
    };
    const started = performance.now();
    expect(
      await evaluateIngestNoiseControls(untouchable, event, {
        integrationId: 'x',
        snapshot,
        prefetch: hanging,
      })
    ).toBeNull();
    // The suite's deadline is 50 ms; an expired one must not be waited for again.
    expect(performance.now() - started).toBeLessThan(40);
  });

  it.each([true, false])(
    'processEvent groups, dedups and pages the same with early lookups %s',
    async enabled => {
      setIngestNoisePrefetch(enabled);
      const { service } = await setup();
      const first = incidentOf(await ingest(service.id));
      await policy(service.id, 'ON', {
        contentDedup: { enabled: true, requireLabelSubset: false },
        storm: { enabled: true, threshold: 1_000 },
      });
      const second = await ingest(service.id);
      expect(incidentOf(second).id).toBe(first.id);
      expect(await decisions(service.id)).toMatchObject([
        { control: 'CONTENT_DEDUP', action: 'APPEND', applied: true },
      ]);
      const other = incidentOf(await ingest(service.id, event({ summary: 'Disk almost full' })));
      expect(other.id).not.toBe(first.id);
      expect(await pagingJobs(other.id)).toHaveLength(1);
    }
  );
});
