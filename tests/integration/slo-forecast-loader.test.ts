import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { getObjectiveForecasts } from '@/lib/slo/forecast-loader';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const now = new Date('2026-11-17T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe('objective budget forecasts', () => {
  it('forecasts availability objectives and lists only incidents the viewer can open', async () => {
    const team = await createTestTeam('Payments');
    const viewer = await createTestUser();
    await db.teamMember.create({ data: { teamId: team.id, userId: viewer.id } });
    const service = await createTestService('Checkout', team.id);
    const visible = await createTestIncident('Visible outage', service.id, {
      createdAt: minutesAgo(600),
      resolvedAt: minutesAgo(580),
      status: 'RESOLVED',
      visibility: 'PUBLIC',
    });
    await createTestIncident('Private outage', service.id, {
      createdAt: minutesAgo(300),
      resolvedAt: minutesAgo(290),
      status: 'RESOLVED',
      visibility: 'PRIVATE',
    });
    const objective = {
      id: 'o1',
      serviceId: service.id,
      metricType: 'AVAILABILITY',
      target: 99.9,
      windowType: 'THIRTY_DAYS',
      windowValue: null,
    };
    const mttr = { ...objective, id: 'o2', metricType: 'MTTR' };
    const actor = (await resolveUserActor(viewer.id))!;

    expect((await getObjectiveForecasts(actor, [objective], now)).size).toBe(0);
    await db.intelligenceSettings.create({
      data: {
        id: 'default',
        ...INTELLIGENCE_SETTINGS_DEFAULTS,
        enabled: true,
        opsHelpersEnabled: true,
      },
    });
    const forecasts = await getObjectiveForecasts(actor, [objective, mttr], now);
    expect([...forecasts.keys()]).toEqual(['o1']);
    const forecast = forecasts.get('o1')!;
    expect(forecast.consumedMinutes).toBe(30);
    expect(forecast.remainingMinutes).toBe(13.2);
    expect(forecast.topIncidents).toEqual([
      { incidentId: visible.id, title: 'Visible outage', minutes: 20 },
    ]);
  });
});
