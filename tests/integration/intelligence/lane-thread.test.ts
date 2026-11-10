// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enqueueWorkItems } from '@/lib/intelligence/jobs/work-queue';
import {
  laneThreadWorker,
  startIntelligenceLaneThread,
  stopIntelligenceLaneThread,
} from '@/lib/intelligence/jobs/lane-thread';
import { getIntelligenceLaneStatus } from '@/lib/intelligence/jobs/runner';
import { evaluateLaneHealth } from '@/lib/intelligence/metrics';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/**
 * The production lane-thread bundle, built by the production build script, running the real lane in a
 * worker thread against PostgreSQL: it does the work, on its own connections, reports to this thread, and
 * stops cleanly.
 */
let entry: string;

beforeAll(async () => {
  const { buildIntelligenceLaneThread } = (await import(
    pathToFileURL(resolve(process.cwd(), 'scripts/build-intelligence-lane-thread.mjs')).href
  )) as {
    buildIntelligenceLaneThread(options: { outfile: string }): Promise<string>;
  };
  entry = await buildIntelligenceLaneThread({
    outfile: 'scripts/dist/intelligence-lane-thread-integration.cjs',
  });
}, 120_000);

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

afterAll(async () => {
  await stopIntelligenceLaneThread();
});

async function laneConnections() {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM pg_stat_activity
    WHERE datname = current_database() AND application_name = 'opsknight-intelligence-lane'`;
  return Number(rows[0]?.count ?? 0);
}

async function until(condition: () => Promise<boolean> | boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

describe('intelligence lane in a worker thread', () => {
  it('runs queued work on its own connections, reports it, and stops cleanly', async () => {
    await db.intelligenceSettings.create({
      data: {
        id: 'default',
        ...INTELLIGENCE_SETTINGS_DEFAULTS,
        maxJobMs: 60_000,
        maxDbMs: 30_000,
        enabled: true,
      },
    });
    const service = await createTestService('Lane thread service');
    const incident = await createTestIncident('Lane thread incident', service.id);
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: incident.id }]);

    expect(startIntelligenceLaneThread({ entry })).toBe(true);
    // The first cycle runs after the lane's initial idle delay (about five seconds).
    await until(() => getIntelligenceLaneStatus().totals.completed >= 1, 25_000);
    const status = getIntelligenceLaneStatus();
    expect(status).toMatchObject({ running: true });
    expect(status.thread).toMatchObject({ state: 'running', restarts: 0 });
    expect(evaluateLaneHealth(status)).toEqual({ status: 'healthy' });
    // The work happened in PostgreSQL, through the lane's own named pool, not this thread's client.
    expect(
      await db.intelligenceWorkItem.count({
        where: { subjectKey: incident.id, kind: 'INDEX_INCIDENT' },
      })
    ).toBe(0);
    expect(await laneConnections()).toBeGreaterThan(0);

    await stopIntelligenceLaneThread();
    expect(laneThreadWorker()).toBeNull();
    expect(getIntelligenceLaneStatus()).toMatchObject({ running: false });
    expect(getIntelligenceLaneStatus().thread?.state).toBe('stopped');
    // Its pool was disconnected before the thread ended.
    await until(async () => (await laneConnections()) === 0, 10_000);
  }, 60_000);
});
