import { beforeEach, describe, expect, it } from 'vitest';
import {
  listMaintenanceWindows,
  listServiceMaintenanceOverview,
  maintenanceWindowPhase,
} from '@/lib/service-maintenance/windows';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const HOUR = 60 * 60_000;

async function insertWindow(serviceId: string, title: string, startsAt: Date, endsAt: Date) {
  return testPrisma.maintenanceWindow.create({
    data: {
      title,
      startsAt,
      endsAt,
      services: { create: { serviceId, startsAt, endsAt } },
    },
  });
}

describeIfRealDB('service maintenance overview', { timeout: 60000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('keeps the active window when many upcoming occurrences exist', async () => {
    const service = await createTestService('Overview');
    const other = await createTestService('Overview Other');
    const now = new Date();
    const active = await insertWindow(
      service.id,
      'active',
      new Date(now.getTime() - HOUR),
      new Date(now.getTime() + HOUR)
    );
    for (let i = 0; i < 25; i++) {
      const start = new Date(now.getTime() + (i + 2) * 12 * HOUR);
      await insertWindow(service.id, `upcoming-${i}`, start, new Date(start.getTime() + HOUR));
    }
    for (let i = 0; i < 7; i++) {
      const end = new Date(now.getTime() - (i + 2) * 24 * HOUR);
      await insertWindow(service.id, `ended-${i}`, new Date(end.getTime() - HOUR), end);
    }
    await insertWindow(
      other.id,
      'other-active',
      new Date(now.getTime() - HOUR),
      new Date(now.getTime() + HOUR)
    );

    // The old single desc-sorted page loses the active window behind upcoming rows.
    const legacy = await listMaintenanceWindows({ serviceIds: [service.id], take: 20, now });
    expect(legacy.map(w => w.id)).not.toContain(active.id);

    const overview = await listServiceMaintenanceOverview(service.id, now);
    const titles = overview.map(w => w.title);
    expect(titles[0]).toBe('active');
    expect(overview.filter(w => maintenanceWindowPhase(w, now) === 'ACTIVE')).toHaveLength(1);
    expect(titles.filter(t => t.startsWith('upcoming-'))).toEqual(
      Array.from({ length: 10 }, (_, i) => `upcoming-${i}`)
    );
    expect(titles.filter(t => t.startsWith('ended-'))).toEqual(
      Array.from({ length: 5 }, (_, i) => `ended-${i}`)
    );
    expect(titles).not.toContain('other-active');
  });
});
