// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enqueueWorkItems } from '@/lib/intelligence/jobs/work-queue';
import {
  laneThreadWorker,
  startIntelligenceLaneThread,
  stopIntelligenceLaneThread,
} from '@/lib/intelligence/jobs/lane-thread';
import { mainThreadLaneStandIn } from '@/lib/intelligence/jobs/lane-stand-in';
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
 * child process against PostgreSQL: it does the work, on its own connections, reports to this process, and
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

describe('intelligence lane in its own process', () => {
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

  it('starts no thread and opens no lane connection while intelligence is disabled', async () => {
    expect(startIntelligenceLaneThread({ entry, standIn: mainThreadLaneStandIn })).toBe(true);
    // The stand-in's first cycle runs after the initial idle delay and reads settings as disabled.
    await until(() => getIntelligenceLaneStatus().totals.cycles >= 1, 25_000);
    const status = getIntelligenceLaneStatus();
    expect(status.thread).toMatchObject({ state: 'parked', restarts: 0 });
    expect(laneThreadWorker()).toBeNull();
    expect(evaluateLaneHealth(status)).toEqual({ status: 'disabled', expected: false });
    expect(await laneConnections()).toBe(0);
    await stopIntelligenceLaneThread();
    expect(getIntelligenceLaneStatus().running).toBe(false);
  }, 60_000);

  it('moves the lane into a thread when enabled and parks it again when disabled', async () => {
    await db.intelligenceSettings.create({
      data: {
        id: 'default',
        ...INTELLIGENCE_SETTINGS_DEFAULTS,
        maxJobMs: 60_000,
        maxDbMs: 30_000,
        enabled: true,
      },
    });
    const service = await createTestService('Parked lane service');
    const incident = await createTestIncident('Parked lane incident', service.id);
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: incident.id }]);

    expect(startIntelligenceLaneThread({ entry, standIn: mainThreadLaneStandIn })).toBe(true);
    expect(laneThreadWorker()).toBeNull();
    // The stand-in's first cycle reads settings as enabled and hands off; the thread does the work.
    await until(() => getIntelligenceLaneStatus().thread?.state === 'running', 30_000);
    await until(() => getIntelligenceLaneStatus().totals.completed >= 1, 30_000);
    expect(await laneConnections()).toBeGreaterThanOrEqual(1);

    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
    await until(() => getIntelligenceLaneStatus().thread?.state === 'parked', 60_000);
    expect(laneThreadWorker()).toBeNull();
    const parked = getIntelligenceLaneStatus();
    expect(parked.thread).toMatchObject({ restarts: 0, lastExit: null });
    // Work the thread did still counts after it is gone, and its connections are closed.
    expect(parked.totals.completed).toBeGreaterThanOrEqual(1);
    await until(async () => (await laneConnections()) === 0, 15_000);
    await stopIntelligenceLaneThread();
  }, 150_000);
});

describe('a lane process that ends with queries in flight', () => {
  const INFLIGHT_LANE = join(
    process.cwd(),
    'tests/fixtures/intelligence-lane-thread/inflight-lane.cjs'
  );

  it('never takes this process down: uncaught errors, restarts and a kill on stop', async () => {
    const inflight: number[] = [];
    startIntelligenceLaneThread({
      entry: INFLIGHT_LANE,
      onMessage: message => {
        if ((message as { type?: string }).type === 'inflight')
          inflight.push((message as { pid: number }).pid);
      },
      poolWaitingQueries: async () => 0,
      restartDelayMs: () => 50,
      stopTimeoutMs: 300,
    });
    const ROUNDS = 3;
    for (let round = 1; round <= ROUNDS; round += 1) {
      await until(() => inflight.length === round, 15_000);
      laneThreadWorker()!.send({ type: 'crash' });
      await until(() => getIntelligenceLaneStatus().thread?.restarts === round, 15_000);
      expect(getIntelligenceLaneStatus().thread?.lastExit).toBe('Lane thread exited with code 1');
    }
    await until(() => inflight.length === ROUNDS + 1, 15_000);
    // The fixture ignores `stop`, so the host kills it with its queries and transaction still running.
    await stopIntelligenceLaneThread();
    expect(laneThreadWorker()).toBeNull();
    // A late callback from a dead engine would abort this process well within this wait.
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const [{ ok }] = await db.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(ok).toBe(1);
  }, 90_000);
});
