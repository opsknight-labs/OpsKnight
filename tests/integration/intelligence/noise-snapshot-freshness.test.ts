import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processEvent, type EventPayload } from '@/lib/events';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  PREPAGING_LIMITS,
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
import { peekPrePagingSnapshot } from '@/lib/intelligence/noise-controls/cache';
import {
  disconnectNoiseLookupClient,
  setNoiseLookupRoute,
} from '@/lib/intelligence/noise-controls/lookup-client';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/**
 * A quiet spell must not leave the hook judging the first alert by policy from before the last change:
 * reads only start a refresh and still serve the old snapshot, so without a timer a maintenance window
 * created a minute ago was ignored by the next alert (and the one after it was suppressed).
 */
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
  setPrePagingDeadlineMs(50);
  await resetDatabase();
});

afterEach(async () => {
  vi.useRealTimers();
  resetPrePagingSnapshot();
  setPrePagingDeadlineMs(null);
  setNoiseLookupRoute(null);
  await disconnectNoiseLookupClient();
});

const event = (summary: string): EventPayload => ({
  event_action: 'trigger',
  dedup_key: `fresh-${Math.random().toString(36).slice(2, 10)}`,
  payload: { summary, source: 'prometheus', severity: 'error' },
});

describe('pre-paging snapshot freshness', () => {
  it('picks up a window created after a quiet spell, before the next alert arrives', async () => {
    await createTestUser({ role: 'ADMIN' });
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    const service = await createTestService('Checkout');
    await db.noiseControlPolicy.create({
      data: {
        scopeKey: `service:${service.id}`,
        serviceId: service.id,
        mode: 'ON',
        definition: { schemaVersion: 1 } as Prisma.InputJsonObject,
      },
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await primePrePagingSnapshot();

    // Another process (or the settings page) saves a window; this process has not heard of it.
    const now = Date.now();
    await db.noiseMaintenanceWindow.create({
      data: {
        name: 'Patching',
        scope: 'SERVICE',
        serviceId: service.id,
        startsAt: new Date(now - 60_000),
        endsAt: new Date(now + 3_600_000),
        effect: 'SUPPRESS',
      },
    });

    // Nothing arrives for a while: the timer, not an alert, refreshes the snapshot.
    await vi.advanceTimersByTimeAsync(PREPAGING_LIMITS.cacheRefreshMs + 1);
    // Wait for that refresh to land without asking for one: the point is that nothing else starts it.
    for (let i = 0; i < 200 && !peekPrePagingSnapshot()?.windows.length; i += 1)
      await db.$queryRaw`SELECT 1`;
    expect(peekPrePagingSnapshot()?.windows).toHaveLength(1);

    const result = await processEvent(event('Checkout pool exhausted'), service.id, 'noise-it');
    expect(result.action).toBe('suppressed');
  });
});
