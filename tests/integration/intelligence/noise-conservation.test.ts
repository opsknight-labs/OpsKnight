import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processEvent, type EventPayload } from '@/lib/events';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
import { disconnectNoiseLookupClient } from '@/lib/intelligence/noise-controls/lookup-client';
import { createTestService, resetDatabase, testPrisma as db } from '../../helpers/test-db';

/**
 * Conservation of alerts. For every trigger that reaches ingestion, exactly one of these holds, and an
 * operator can see which:
 *   - it opened an incident that was paged,
 *   - it opened a SUPPRESSED incident, with an applied SUPPRESS decision row,
 *   - it was dropped, with an applied DROP decision row,
 *   - it joined an incident that was already open.
 * And a critical alert is only ever hidden by a control that explicitly covers critical.
 *
 * Seeded random streams of triggers and resolves over services that carry random combinations of a
 * maintenance window, a suppression rule and an orchestration DROP, each with or without `coversCritical`.
 */
const SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
const KEYS = ['db', 'cache', 'queue', 'disk'];
const STEPS = 30;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
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

const pagingJobs = (incidentId: string) =>
  db.backgroundJob.count({
    where: {
      payload: { path: ['incidentId'], equals: incidentId },
      OR: [
        { type: 'ESCALATION', status: 'PENDING' },
        { payload: { path: ['effect'], equals: 'TRIGGER_ESCALATION_NOTIFICATIONS' } },
      ],
    },
  });

describe('alert conservation under random noise-control configurations', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i', async seed => {
    const next = random(seed);
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const services = [await createTestService('Alpha'), await createTestService('Beta')];

    // What can hide critical alerts in this run.
    const coversCritical = {
      window: next() < 0.3,
      rule: next() < 0.3,
      drop: next() < 0.3,
    };
    const windowOn = services.map(() => next() < 0.6);
    const ruleOn = next() < 0.6;
    const dropOn = services.map(() => next() < 0.5);

    for (const [index, service] of services.entries()) {
      if (windowOn[index])
        await db.noiseMaintenanceWindow.create({
          data: {
            name: `Patching ${index}`,
            scope: 'SERVICE',
            serviceId: service.id,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 3_600_000),
            effect: 'SUPPRESS',
            coversCritical: coversCritical.window,
          },
        });
      await db.noiseControlPolicy.create({
        data: {
          scopeKey: `service:${service.id}`,
          serviceId: service.id,
          mode: 'ON',
          definition: {
            schemaVersion: 1,
            orchestration: {
              rules: dropOn[index]
                ? [
                    {
                      id: 'drop-info',
                      name: 'Drop info',
                      coversCritical: coversCritical.drop,
                      conditions: [{ field: 'severity', op: 'equals', value: 'info' }],
                      actions: [{ type: 'DROP' }],
                    },
                  ]
                : [],
            },
          } as Prisma.InputJsonObject,
        },
      });
    }
    if (ruleOn)
      await db.suppressionRule.create({
        data: {
          name: 'Quiet warnings',
          matchers: [{ field: 'severity', op: 'equals', value: 'warning' }],
          effect: 'SUPPRESS',
          coversCritical: coversCritical.rule,
        },
      });
    await primePrePagingSnapshot();

    const open = new Map<string, string>(); // `${serviceId}:${key}` → incident id
    const failures: string[] = [];
    for (let step = 0; step < STEPS; step += 1) {
      const index = Math.floor(next() * services.length);
      const service = services[index]!;
      const key = pick(KEYS);
      const slot = `${service.id}:${key}`;
      const send = (action: EventPayload['event_action'], severity: (typeof SEVERITIES)[number]) =>
        processEvent(
          {
            event_action: action,
            dedup_key: key,
            payload: { summary: `${key} ${severity} ${step}`, source: 'prometheus', severity },
          },
          service.id,
          'conservation'
        );

      if (open.has(slot) && next() < 0.3) {
        await send('resolve', 'info');
        open.delete(slot);
        continue;
      }

      const severity = pick(SEVERITIES);
      const dropsBefore = await db.prePagingDecision.count({
        where: { serviceId: service.id, action: 'DROP', applied: true },
      });
      const result = await send('trigger', severity);
      const label = `step ${step} ${service.name} ${key} ${severity}`;

      if (open.has(slot)) {
        if (result.action !== 'deduplicated')
          failures.push(`${label}: expected a dedup, got ${result.action}`);
        continue;
      }
      if (result.action === 'dropped') {
        const drops = await db.prePagingDecision.count({
          where: { serviceId: service.id, action: 'DROP', applied: true },
        });
        if (drops !== dropsBefore + 1) failures.push(`${label}: dropped with no decision row`);
        if (severity === 'critical' && !coversCritical.drop)
          failures.push(`${label}: a critical alert was dropped by a rule that does not cover it`);
        continue;
      }
      if (!('incident' in result) || !result.incident) {
        failures.push(`${label}: no incident and not dropped (${result.action})`);
        continue;
      }
      const incident = result.incident;
      open.set(slot, incident.id);
      if (incident.status === 'SUPPRESSED') {
        const decided = await db.prePagingDecision.count({
          where: { incidentId: incident.id, action: 'SUPPRESS', applied: true },
        });
        if (decided === 0) failures.push(`${label}: suppressed with no decision row`);
        if (severity === 'critical' && !(coversCritical.window || coversCritical.rule))
          failures.push(
            `${label}: a critical alert was suppressed by a control that does not cover it`
          );
      } else if ((await pagingJobs(incident.id)) !== 1) {
        failures.push(`${label}: opened ${incident.status} but was not paged`);
      }
    }
    expect(failures).toEqual([]);
  });
});
