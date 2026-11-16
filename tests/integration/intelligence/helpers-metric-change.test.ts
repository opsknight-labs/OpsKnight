import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  explainMetricChangeFor,
  loadMetricChanges,
} from '@/lib/intelligence/helpers/metric-change-loader';
import {
  createTestService,
  createTestTeam,
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

const NOW = new Date('2026-11-10T12:00:00Z');
const day = (offset: number) => new Date(Date.UTC(2026, 10, 10 + offset));

async function actorFor(userId: string) {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
}

const switches = (opsHelpersEnabled: boolean) =>
  db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, opsHelpersEnabled },
  });

const rollup = (serviceId: string, date: Date, totalIncidents: number, ackMinutes = 0) =>
  db.incidentMetricRollup.create({
    data: {
      serviceId,
      date,
      granularity: 'daily',
      totalIncidents,
      mttaSum: BigInt(ackMinutes * 60_000 * totalIncidents),
      mttaCount: ackMinutes ? totalIncidents : 0,
    },
  });

/** Payments rose 2 → 12 and checkout 1 → 3 (inside the last 7 days vs the 7 before); search fell 4 → 3. */
async function fixture() {
  const mine = await createTestTeam('Mine');
  const theirs = await createTestTeam('Theirs');
  const payments = await createTestService('Payments', mine.id);
  const checkout = await createTestService('Checkout', theirs.id);
  const search = await createTestService('Search', mine.id);
  await Promise.all([
    rollup(payments.id, day(-10), 2, 5),
    rollup(payments.id, day(-2), 12, 20),
    rollup(checkout.id, day(-9), 1, 5),
    rollup(checkout.id, day(-3), 3, 5),
    rollup(search.id, day(-8), 4, 5),
    rollup(search.id, day(-1), 3, 5),
    // Today is incomplete and older than the comparison window: neither counts.
    rollup(payments.id, day(0), 50, 5),
    rollup(payments.id, day(-20), 50, 5),
  ]);
  return { mine, payments, checkout, search };
}

describe('why did this metric change', () => {
  it('splits the incident change per service exactly, from the daily rollups', async () => {
    await switches(true);
    const admin = await actorFor((await createTestUser({ role: 'ADMIN' })).id);
    const { payments, checkout } = await fixture();

    const changes = await loadMetricChanges(admin, { windowDays: 7, now: NOW });

    expect(changes.incidents).toMatchObject({
      direction: 'up',
      previous: 7,
      current: 18,
      contributors: [
        { serviceId: payments.id, delta: 10 },
        { serviceId: checkout.id, delta: 2 },
      ],
    });
    expect(changes.incidents?.line).toBe(
      `Most of the rise: ${payments.name} +10, ${checkout.name} +2`
    );
    expect(changes.mtta?.direction).toBe('up');
    expect(changes.mtta?.contributors[0]?.serviceId).toBe(payments.id);
  });

  it('limits the totals and the names to services the viewer may read', async () => {
    await switches(true);
    const { mine, payments } = await fixture();
    const responder = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { teamId: mine.id, userId: responder.id, role: 'MEMBER' } });

    const changes = await loadMetricChanges(await actorFor(responder.id), {
      windowDays: 7,
      now: NOW,
    });

    expect(changes.incidents).toMatchObject({ previous: 6, current: 15 });
    expect(changes.incidents?.contributors.map(c => c.serviceId)).toEqual([payments.id]);
    expect(changes.incidents?.line).not.toContain('Checkout');
  });

  it('is empty while the helper switch is off, or for an out-of-range window', async () => {
    await switches(false);
    const admin = await actorFor((await createTestUser({ role: 'ADMIN' })).id);
    await fixture();

    expect(await loadMetricChanges(admin, { windowDays: 7, now: NOW })).toEqual({});
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { opsHelpersEnabled: true },
    });
    expect(await loadMetricChanges(admin, { windowDays: 0, now: NOW })).toEqual({});
    expect(await loadMetricChanges(admin, { windowDays: 365, now: NOW })).toEqual({});
  });

  it('explains an expanded card deterministically without an AI provider', async () => {
    await switches(true);
    const admin = await actorFor((await createTestUser({ role: 'ADMIN' })).id);
    await fixture();

    const detail = await explainMetricChangeFor(admin, 'incidents', { windowDays: 7, now: NOW });

    expect(detail).toEqual({
      detail:
        'Incident count went from 7 to 18 between the previous and the last 7 complete days. The services listed account for 109% of that change.',
      phrasing: null,
    });
  });
});
