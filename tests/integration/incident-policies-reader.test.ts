import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';
import {
  readPublishedClassificationPolicies,
  readPublishedSlaPolicies,
  readPublishedSupportPolicies,
} from '@/lib/incident-policies/published';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
afterAll(() => db.$disconnect());

it('reads latest sealed classification versions and rules in requested precedence order with one statement', async () => {
  for (const [scopeKey, version, sealed] of [
    ['service:reader', 1, true],
    ['service:reader', 2, true],
    ['service:reader', 3, false],
    ['integration:reader', 1, true],
  ] as const) {
    const policy = await db.incidentClassificationPolicy.create({
      data: {
        scopeKey,
        version,
        inheritWorkspace: true,
        rules: {
          create: {
            matchType: 'ALERT_SEVERITY',
            matchValue: 'critical',
            priority: 'P1',
            urgency: 'HIGH',
            priorityMode: 'SET',
            urgencyMode: 'SET',
          },
        },
      },
    });
    if (sealed)
      await db.incidentClassificationPolicy.update({
        where: { id: policy.id },
        data: { sealedAt: new Date() },
      });
  }
  const query = vi.spyOn(db, '$queryRaw');
  try {
    const policies = await readPublishedClassificationPolicies(db, [
      'integration:reader',
      'service:reader',
      'workspace',
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(policies.map(policy => [policy.scopeKey, policy.version])).toEqual([
      ['integration:reader', 1],
      ['service:reader', 2],
      ['workspace', 1],
    ]);
    expect(policies[1].rules[0]).toMatchObject({
      priority: 'P1',
      urgency: 'HIGH',
      matchValue: 'critical',
    });
  } finally {
    query.mockRestore();
  }
});

it('keeps SLA versions bounded and hydrates support exceptions as UTC dates', async () => {
  for (const version of [1, 2]) {
    const policy = await db.incidentSlaPolicy.create({
      data: {
        scopeKey: 'service:reader',
        version,
        inheritWorkspace: false,
        baseAckTargetMs: version * 60000,
        baseResolveTargetMs: version * 120000,
        rules: {
          create: { priority: 'P1', ackTargetMs: version * 1000, resolveTargetMs: version * 2000 },
        },
      },
    });
    await db.incidentSlaPolicy.update({ where: { id: policy.id }, data: { sealedAt: new Date() } });
  }
  const support = await db.responseSupportHoursPolicy.create({
    data: {
      scopeKey: 'service:reader',
      version: 1,
      timezone: 'Asia/Kolkata',
      inheritWorkspace: false,
      mode: 'SCHEDULED',
      windows: { create: { dayOfWeek: 1, startMinute: 540, endMinute: 1020 } },
      exceptions: { create: { localDate: new Date('2026-10-26T00:00:00Z'), available: false } },
    },
  });
  await db.responseSupportHoursPolicy.update({
    where: { id: support.id },
    data: { sealedAt: new Date() },
  });
  const query = vi.spyOn(db, '$queryRaw');
  try {
    const sla = await readPublishedSlaPolicies(db, ['service:reader', 'workspace']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(sla.map(policy => policy.version)).toEqual([2, 1]);
    expect(sla[0].rules[0]).toMatchObject({
      priority: 'P1',
      ackTargetMs: 2000,
      resolveTargetMs: 4000,
    });
    query.mockClear();
    const hours = await readPublishedSupportPolicies(db, ['service:reader', 'workspace']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(hours[0].timezone).toBe('Asia/Kolkata');
    expect(hours[0].exceptions[0].localDate).toBeInstanceOf(Date);
    expect(hours[0].exceptions[0].localDate.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(hours[0].windows[0]).toMatchObject({ startMinute: 540, endMinute: 1020 });
  } finally {
    query.mockRestore();
  }
});
