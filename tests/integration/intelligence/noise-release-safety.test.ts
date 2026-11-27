import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processEvent, type EventPayload } from '@/lib/events';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
import { disconnectNoiseLookupClient } from '@/lib/intelligence/noise-controls/lookup-client';
import { createLaneState, runIntelligenceCycle } from '@/lib/intelligence/jobs/runner';
import {
  resetNoiseSweepSchedule,
  runUnsuppressSweep,
} from '@/lib/intelligence/noise-controls/sweep';
import { createTestService, resetDatabase, testPrisma as db } from '../../helpers/test-db';

/**
 * Release safety: the ways an important alert could be hidden or left unpaged by the pre-paging noise
 * controls. Every test states the behaviour a responder relies on; a failing test is a confirmed defect.
 */
const integrationId = 'noise-safety';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
  resetNoiseSweepSchedule();
  setPrePagingDeadlineMs(50);
  await resetDatabase();
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
});
afterAll(async () => {
  setPrePagingDeadlineMs(null);
  await disconnectNoiseLookupClient();
});

async function policy(serviceId: string, definition: Record<string, unknown> = {}) {
  await db.noiseControlPolicy.create({
    data: {
      scopeKey: `service:${serviceId}`,
      serviceId,
      mode: 'ON',
      definition: { schemaVersion: 1, ...definition } as Prisma.InputJsonObject,
    },
  });
  await primePrePagingSnapshot();
}

let sequence = 0;
function send(
  serviceId: string,
  overrides: Partial<EventPayload['payload']> = {},
  dedup?: string,
  action: EventPayload['event_action'] = 'trigger'
) {
  sequence += 1;
  return processEvent(
    {
      event_action: action,
      dedup_key: dedup ?? `safety-${sequence}-${Math.random().toString(36).slice(2, 8)}`,
      payload: {
        summary: 'Checkout pool exhausted',
        source: 'prometheus',
        severity: 'error',
        ...overrides,
      },
    },
    serviceId,
    integrationId
  );
}

function incidentOf(result: Awaited<ReturnType<typeof processEvent>>) {
  if (!('incident' in result) || !result.incident) throw new Error('expected an incident');
  return result.incident;
}

/** Pending paging work for the incident: a new incident queues a notification effect, a released one an escalation. */
async function pagingJobs(incidentId: string) {
  return db.backgroundJob.findMany({
    where: {
      payload: { path: ['incidentId'], equals: incidentId },
      OR: [
        { type: 'ESCALATION', status: 'PENDING' },
        { payload: { path: ['effect'], equals: 'TRIGGER_ESCALATION_NOTIFICATIONS' } },
      ],
    },
    select: { scheduledAt: true },
  });
}

const activeWindow = (serviceId: string, extra: Record<string, unknown> = {}) =>
  db.noiseMaintenanceWindow.create({
    data: {
      name: 'Patching',
      scope: 'SERVICE',
      serviceId,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      effect: 'SUPPRESS',
      ...extra,
    },
  });

const matchAll = [{ field: 'source', op: 'contains', value: 'prom' }];

describe('critical alerts are not hidden by static controls (N1)', () => {
  it('pages a critical alert inside a suppressing maintenance window', async () => {
    const service = await createTestService('Checkout');
    await activeWindow(service.id);
    await policy(service.id);
    const incident = incidentOf(await send(service.id, { severity: 'critical' }));
    expect(incident.urgency).toBe('HIGH');
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
  });

  it('pages a critical alert matching a suppression rule', async () => {
    const service = await createTestService('Checkout');
    await db.suppressionRule.create({
      data: { name: 'Everything from prometheus', matchers: matchAll, effect: 'SUPPRESS' },
    });
    await policy(service.id);
    const incident = incidentOf(await send(service.id, { severity: 'critical' }));
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
  });

  it('pages a critical alert matching an orchestration DROP', async () => {
    const service = await createTestService('Checkout');
    await policy(service.id, {
      orchestration: {
        rules: [
          {
            id: 'drop-prom',
            name: 'Drop prometheus',
            conditions: matchAll,
            actions: [{ type: 'DROP' }],
          },
        ],
      },
    });
    const result = await send(service.id, { severity: 'critical' });
    expect(result.action).not.toBe('dropped');
    const incident = incidentOf(result);
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
  });

  it('still suppresses a non-critical alert in the same window', async () => {
    const service = await createTestService('Checkout');
    await activeWindow(service.id);
    await policy(service.id);
    const result = await send(service.id, { severity: 'warning' });
    expect(result.action).toBe('suppressed');
  });
});

describe('the critical guard can be opted out of, per control', () => {
  it('suppresses a critical alert in a window that covers critical', async () => {
    const service = await createTestService('Checkout');
    await activeWindow(service.id, { coversCritical: true });
    await policy(service.id);
    const result = await send(service.id, { severity: 'critical' });
    expect(result.action).toBe('suppressed');
  });

  it('suppresses a critical alert matching a rule that covers critical', async () => {
    const service = await createTestService('Checkout');
    await db.suppressionRule.create({
      data: { name: 'Everything', matchers: matchAll, effect: 'SUPPRESS', coversCritical: true },
    });
    await policy(service.id);
    expect((await send(service.id, { severity: 'critical' })).action).toBe('suppressed');
  });

  it('drops a critical alert matching an orchestration DROP that covers critical', async () => {
    const service = await createTestService('Checkout');
    await policy(service.id, {
      orchestration: {
        rules: [
          {
            id: 'drop-prom',
            name: 'Drop prometheus',
            coversCritical: true,
            conditions: matchAll,
            actions: [{ type: 'DROP' }],
          },
        ],
      },
    });
    expect((await send(service.id, { severity: 'critical' })).action).toBe('dropped');
  });

  it('does not downgrade a critical alert in a downgrade window', async () => {
    const service = await createTestService('Checkout');
    await activeWindow(service.id, { effect: 'DOWNGRADE', downgradeUrgency: 'LOW' });
    await policy(service.id);
    const incident = incidentOf(await send(service.id, { severity: 'critical' }));
    expect(incident.urgency).toBe('HIGH');
  });
});

describe('a worse alert on a suppressed incident is paged (N3)', () => {
  it('pages when the same dedup key re-fires as critical', async () => {
    const service = await createTestService('Checkout');
    await db.suppressionRule.create({
      data: {
        name: 'Quiet warnings',
        matchers: [{ field: 'severity', op: 'equals', value: 'warning' }],
        effect: 'SUPPRESS',
      },
    });
    await policy(service.id);
    const first = await send(service.id, { severity: 'warning' }, 'same-key');
    const suppressed = incidentOf(first);
    expect(suppressed.status).toBe('SUPPRESSED');

    const second = await send(service.id, { severity: 'critical' }, 'same-key');
    const after = await db.incident.findUniqueOrThrow({ where: { id: incidentOf(second).id } });
    expect(after.urgency).toBe('HIGH');
    expect(after.status).not.toBe('SUPPRESSED');
    expect(await pagingJobs(after.id)).toHaveLength(1);
  });
});

describe('an orchestration SUPPRESS is released when its rule goes away (N4)', () => {
  it('pages the still-firing alert after the rule is disabled', async () => {
    const service = await createTestService('Checkout');
    const rule = {
      id: 'quiet-prom',
      name: 'Quiet prometheus',
      conditions: matchAll,
      actions: [{ type: 'SUPPRESS' }],
    };
    await policy(service.id, { orchestration: { rules: [rule] } });
    const incident = incidentOf(await send(service.id, { severity: 'warning' }));
    expect(incident.status).toBe('SUPPRESSED');

    await db.noiseControlPolicy.update({
      where: { scopeKey: `service:${service.id}` },
      data: {
        definition: {
          schemaVersion: 1,
          orchestration: { rules: [{ ...rule, enabled: false }] },
        } as Prisma.InputJsonObject,
        revision: { increment: 1 },
      },
    });
    await primePrePagingSnapshot();
    await runUnsuppressSweep({ maxDbMs: 5_000 }, { now: new Date(Date.now() + 60_000) });

    const after = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(after.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
  });
});

describe('a dropped alert does not swallow its re-fire (N9)', () => {
  it('pages when the alert fires again after a DROP and its resolve', async () => {
    const service = await createTestService('Checkout');
    await policy(service.id, {
      orchestration: {
        rules: [
          {
            id: 'drop-warning',
            name: 'Drop warnings',
            conditions: [{ field: 'severity', op: 'equals', value: 'warning' }],
            actions: [{ type: 'DROP' }],
          },
        ],
      },
    });
    const dropped = await send(service.id, { severity: 'warning' }, 'flappy');
    expect(dropped.action).toBe('dropped');
    await send(service.id, { severity: 'warning' }, 'flappy', 'resolve');

    // The rule is switched off (the operator decides these alerts matter), then the alert fires again.
    await db.noiseControlPolicy.update({
      where: { scopeKey: `service:${service.id}` },
      data: { definition: { schemaVersion: 1 } as Prisma.InputJsonObject },
    });
    await primePrePagingSnapshot();
    const again = await send(service.id, { severity: 'warning' }, 'flappy');
    const incident = incidentOf(again);
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
  });
});

describe('overlapping windows give one stable answer (N7)', () => {
  it('lets a SUPPRESS window win over a DOWNGRADE window, whatever the row order', async () => {
    const service = await createTestService('Checkout');
    await activeWindow(service.id, { name: 'Downgrade', effect: 'DOWNGRADE', downgradeUrgency: 'LOW' });
    await activeWindow(service.id, { name: 'Suppress' });
    await policy(service.id);
    const results = [] as string[];
    for (let i = 0; i < 3; i += 1) {
      results.push((await send(service.id, { severity: 'warning' })).action);
    }
    expect(new Set(results).size).toBe(1);
  });
});

describe('the audit trail never beats paging (N11)', () => {
  afterEach(async () => {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_decision_insert ON "PrePagingDecision"');
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_decision_insert()');
  });

  it('still opens and pages the incident when recording a shadow decision fails', async () => {
    const service = await createTestService('Checkout');
    await activeWindow(service.id);
    await db.noiseControlPolicy.create({
      data: {
        scopeKey: `service:${service.id}`,
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1 } as Prisma.InputJsonObject,
      },
    });
    await primePrePagingSnapshot();
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_decision_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'decision table unavailable'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_decision_insert BEFORE INSERT ON "PrePagingDecision"
      FOR EACH ROW EXECUTE FUNCTION fail_decision_insert()`);

    const incident = incidentOf(await send(service.id, { severity: 'warning' }));
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
  });
});

describe('suppressed incidents are released even with Intelligence switched off (N5)', () => {
  it('pages the still-firing alert after its window ends, when the master switch is off', async () => {
    const service = await createTestService('Checkout');
    const window = await activeWindow(service.id);
    await policy(service.id);
    const incident = incidentOf(await send(service.id, { severity: 'warning' }));
    expect(incident.status).toBe('SUPPRESSED');

    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
    await db.noiseMaintenanceWindow.update({
      where: { id: window.id },
      data: { startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 1_000) },
    });
    resetNoiseSweepSchedule();
    await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: async () => 0 });

    const after = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(after.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toHaveLength(1);
  });
});
