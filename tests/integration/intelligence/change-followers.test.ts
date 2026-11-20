import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { getChangeFollowers } from '@/lib/intelligence/changes/followers';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

describe('incidents that followed a change', () => {
  it('lists incidents within two hours on the service and its dependants, with the risk score', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const api = await createTestService('Api');
    const web = await createTestService('Web');
    const unrelated = await createTestService('Unrelated');
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: api.id,
        downstreamServiceId: web.id,
        origin: 'DECLARED',
        evidence: {},
      },
    });
    const at = new Date(Date.now() - 6 * 3_600_000);
    const change = await db.changeEvent.create({
      data: {
        serviceId: api.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'v2',
        occurredAt: at,
        riskScore: 0.8,
      },
    });
    const after = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
    const own = await createTestIncident('Api errors', api.id, { createdAt: after(10) });
    const dependant = await createTestIncident('Web slow', web.id, { createdAt: after(90) });
    await createTestIncident('Too late', api.id, { createdAt: after(150) });
    await createTestIncident('Before', api.id, { createdAt: after(-5) });
    await createTestIncident('Elsewhere', unrelated.id, { createdAt: after(20) });
    const actor = (await resolveUserActor(admin.id))!;

    expect(await getChangeFollowers(actor, change.id)).toBeNull();
    await db.intelligenceSettings.create({
      data: {
        id: 'default',
        ...INTELLIGENCE_SETTINGS_DEFAULTS,
        enabled: true,
        opsHelpersEnabled: true,
      },
    });
    const followers = await getChangeFollowers(actor, change.id);
    expect(followers?.riskScore).toBe(0.8);
    expect(followers?.incidents.map(i => [i.id, i.minutesAfter, i.dependant])).toEqual([
      [own.id, 10, false],
      [dependant.id, 90, true],
    ]);
  });
});
