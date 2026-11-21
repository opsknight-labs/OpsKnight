import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { evaluatePause } from '@/lib/intelligence/jobs/backpressure';
import { enqueueWorkItems } from '@/lib/intelligence/jobs/work-queue';
import { DISCOVERY_SAFETY_LAG_MS } from '@/lib/intelligence/jobs/discovery';
import { IngestionYield } from '@/lib/intelligence/jobs/ingestion-yield';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  getIntelligenceLaneStatus,
  runIntelligenceCycle,
  shouldRunIntelligenceLane,
  startIntelligenceLane,
  stopIntelligenceLane,
  type WorkHandler,
} from '@/lib/intelligence/jobs/runner';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import {
  publishPolicyVersion,
  type IntelligenceSettingsView,
} from '@/lib/intelligence/settings/service';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function enable(overrides: Partial<IntelligenceSettingsView> = {}) {
  // Generous budgets keep these tests independent of CI load; the timeout test overrides them.
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      maxJobMs: 60_000,
      maxDbMs: 30_000,
      enabled: true,
      ...overrides,
    },
  });
}

const noLag = async () => 0;

describe('backpressure hysteresis', () => {
  it('pauses above the threshold and resumes only below half of it', () => {
    expect(evaluatePause({ paused: false }, 14_000, 15_000)).toEqual({
      paused: false,
      changed: false,
    });
    expect(evaluatePause({ paused: false }, 16_000, 15_000)).toEqual({
      paused: true,
      changed: true,
    });
    expect(evaluatePause({ paused: true }, 10_000, 15_000)).toEqual({
      paused: true,
      changed: false,
    });
    expect(evaluatePause({ paused: true }, 7_000, 15_000)).toEqual({
      paused: false,
      changed: true,
    });
  });
});

describe('lane lifecycle', () => {
  it('runs only on roles that host workers, never on web or scheduler-only roles', () => {
    for (const role of ['integrated', 'worker', 'general-worker', 'intelligence-worker']) {
      expect(shouldRunIntelligenceLane(role)).toBe(true);
    }
    for (const role of [
      'web',
      'scheduler',
      'critical-worker',
      'bulk-worker',
      'status-projector',
      'runbook-worker',
      'ingestion-worker',
    ]) {
      expect(shouldRunIntelligenceLane(role)).toBe(false);
    }
  });

  it('starts idempotently and stops cleanly', async () => {
    startIntelligenceLane();
    startIntelligenceLane();
    expect(getIntelligenceLaneStatus().running).toBe(true);
    await stopIntelligenceLane();
    expect(getIntelligenceLaneStatus().running).toBe(false);
    await stopIntelligenceLane(); // stopping twice is harmless
  });
});

describe('intelligence cycle', () => {
  it('leaves queued work untouched during pool pressure and resumes after two quiet samples', async () => {
    await enable();
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: 'pool-pressure-test' }]);
    const state = createLaneState();
    const lag = vi.fn().mockResolvedValue(0);
    const waiting = vi.fn().mockResolvedValueOnce(2).mockResolvedValue(0);
    const handler = vi.fn().mockResolvedValue(undefined);
    const deps = {
      getCriticalLagMs: lag,
      getPoolWaitingQueries: waiting,
      handlers: { INDEX_INCIDENT: handler },
    };
    expect(await runIntelligenceCycle(state, deps)).toMatchObject({ status: 'paused', claimed: 0 });
    expect(lag).not.toHaveBeenCalled();
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).attempts).toBe(0);
    expect((await runIntelligenceCycle(state, deps)).status).toBe('paused');
    expect(await runIntelligenceCycle(state, deps)).toMatchObject({
      status: 'worked',
      completed: 1,
    });
    expect(handler).toHaveBeenCalledOnce();
  });
  it('does nothing and touches no queue while intelligence is disabled', async () => {
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: 'x' }]);
    const result = await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: noLag });
    expect(result.status).toBe('disabled');
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).attempts).toBe(0);
    expect(await db.intelligenceCursor.count()).toBe(0);
  });

  it('yields completely while the paging path is backed up, then resumes', async () => {
    await enable();
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: 'x' }]);
    const state = createLaneState();
    const paused = await runIntelligenceCycle(state, { getCriticalLagMs: async () => 60_000 });
    expect(paused).toMatchObject({ status: 'paused', claimed: 0 });
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).attempts).toBe(0);

    // Lag fell below the threshold but not below half of it: stay paused.
    expect(
      (await runIntelligenceCycle(state, { getCriticalLagMs: async () => 10_000 })).status
    ).toBe('paused');
    expect(
      (await runIntelligenceCycle(state, { getCriticalLagMs: async () => 1_000 })).status
    ).not.toBe('paused');
  });

  it('indexes newly created incidents end to end', async () => {
    await enable();
    const service = await createTestService('Checkout');
    const state = createLaneState();
    let clock = Date.now();
    const deps = { getCriticalLagMs: noLag, now: () => clock };

    await runIntelligenceCycle(state, deps); // initialises the discovery cursor
    const created = await createTestIncident('Latency high on api-3', service.id);
    clock = Date.now() + DISCOVERY_SAFETY_LAG_MS + 5000;
    const result = await runIntelligenceCycle(state, deps);

    expect(result).toMatchObject({
      status: 'worked',
      discovered: 1,
      claimed: 1,
      completed: 1,
      failed: 0,
    });
    // With no policy the effective mode is OFF: only an empty placeholder is kept and nothing follows.
    const placeholder = await db.incidentFingerprint.findUniqueOrThrow({
      where: { incidentId: created.id },
    });
    expect(placeholder).toMatchObject({ template: '', tokens: [], templateHash: null });
    expect(await db.intelligenceWorkItem.count()).toBe(0);
    expect(await db.intelligenceFinding.count()).toBe(0);
  });

  it('fingerprints and chains analysis in one step once a policy is on', async () => {
    await enable();
    const admin = await db.user.create({
      data: {
        email: 'index@example.com',
        name: 'A',
        passwordHash: 'x',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
    const service = await createTestService('Checkout');
    const created = await createTestIncident('Latency high on api-3', service.id);
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: created.id }]);

    expect(
      await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: noLag })
      // A fresh lane also drains its coalesced, lower-priority dependency observation job.
    ).toMatchObject({ claimed: 2, completed: 2, failed: 0 });
    const fingerprint = await db.incidentFingerprint.findUniqueOrThrow({
      where: { incidentId: created.id },
    });
    expect(fingerprint.template).toBe('latency high on api-<num>');
    expect(fingerprint.templateHash).toMatch(/^[0-9a-f]{32}$/);
    expect(
      (await db.intelligenceWorkItem.findMany({ orderBy: { priority: 'asc' } })).map(i => i.kind)
    ).toEqual(['ANALYZE_INCIDENT', 'ANALYZE_RESPONSE']);
    await db.intelligenceWorkItem.deleteMany();
    const item = {
      id: 'direct',
      kind: 'INDEX_INCIDENT',
      subjectKey: created.id,
      generation: 1,
      claimToken: 'direct',
      attempts: 1,
    };
    const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1, enabled: true };
    await DEFAULT_HANDLERS.INDEX_INCIDENT!(item, {
      settings,
      signal: new AbortController().signal,
    });
    expect(await db.intelligenceWorkItem.count()).toBe(0);
    await DEFAULT_HANDLERS.INDEX_INCIDENT!(
      { ...item, force: true },
      { settings, signal: new AbortController().signal }
    );
    expect(await db.intelligenceWorkItem.count()).toBe(2);
  });

  it('chains response analysis only when the policy allows it, and produces findings end to end', async () => {
    await enable();
    const admin = await db.user.create({
      data: {
        email: 'chain@example.com',
        name: 'A',
        passwordHash: 'x',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
    const service = await createTestService('Checkout');
    const state = createLaneState();
    let clock = Date.now();
    const deps = { getCriticalLagMs: noLag, now: () => clock };

    await runIntelligenceCycle(state, deps);
    const created = await createTestIncident('Latency high on api-3', service.id);
    await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'v1',
        occurredAt: new Date(created.createdAt.getTime() - 120_000),
      },
    });
    clock = Date.now() + DISCOVERY_SAFETY_LAG_MS + 5000;
    // Cycle until indexing has chained its follow-ups; under load an item may legitimately retry once.
    let chained: string[] = [];
    for (let i = 0; i < 20 && chained.length < 2; i += 1) {
      await runIntelligenceCycle(state, deps);
      chained = (await db.intelligenceWorkItem.findMany({ orderBy: { kind: 'asc' } })).map(
        item => item.kind
      );
      if (chained.length < 2) await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(chained).toEqual(['ANALYZE_INCIDENT', 'ANALYZE_RESPONSE']);
    for (let i = 0; i < 20 && (await db.intelligenceWorkItem.count()) > 0; i += 1) {
      await runIntelligenceCycle(state, deps);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const finding = await db.intelligenceFinding.findFirstOrThrow({
      where: { incidentId: created.id, kind: 'CHANGE_CORRELATION' },
    });
    expect(finding.status).toBe('ACTIVE');
    expect(await db.intelligenceWorkItem.count()).toBe(0);
  });

  it('isolates a failing item from the rest of the batch and retries it with backoff', async () => {
    await enable();
    await enqueueWorkItems([
      { kind: 'INDEX_INCIDENT', subjectKey: 'bad' },
      { kind: 'INDEX_INCIDENT', subjectKey: 'good-1' },
      { kind: 'INDEX_INCIDENT', subjectKey: 'good-2' },
    ]);
    const seen: string[] = [];
    const handler: WorkHandler = async item => {
      if (item.subjectKey === 'bad') throw new Error('handler exploded');
      seen.push(item.subjectKey);
    };
    const result = await runIntelligenceCycle(createLaneState(), {
      getCriticalLagMs: noLag,
      handlers: { INDEX_INCIDENT: handler },
    });
    expect(result).toMatchObject({ claimed: 3, completed: 2, failed: 1 });
    expect(seen.sort()).toEqual(['good-1', 'good-2']);
    const remaining = await db.intelligenceWorkItem.findFirstOrThrow();
    expect(remaining).toMatchObject({ subjectKey: 'bad', lastError: 'work:v1:UNKNOWN' });
    expect(remaining.scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('enforces the per-item time budget', async () => {
    await enable({ maxJobMs: 100, maxDbMs: 100 });
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: 'slow' }]);
    let aborted = false;
    const handler: WorkHandler = async (_item, { signal }) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    };
    const started = Date.now();
    const result = await runIntelligenceCycle(createLaneState(), {
      getCriticalLagMs: noLag,
      handlers: { INDEX_INCIDENT: handler },
    });
    expect(Date.now() - started).toBeLessThan(900);
    expect(result).toMatchObject({ failed: 1, completed: 0 });
    expect(aborted).toBe(true);
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).lastError).toBe(
      'work:v1:WORK_BUDGET'
    );
  });

  it('fails work with no registered handler instead of dropping it', async () => {
    await enable();
    await db.intelligenceWorkItem.create({ data: { kind: 'UNKNOWN_KIND', subjectKey: 'x' } });
    const result = await runIntelligenceCycle(createLaneState(), {
      getCriticalLagMs: noLag,
      handlers: DEFAULT_HANDLERS,
    });
    expect(result.failed).toBe(1);
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).lastError).toBe('work:v1:UNKNOWN');
  });

  it('never exceeds the configured concurrency', async () => {
    await enable({ maxConcurrency: 2, batchSize: 10 });
    await enqueueWorkItems(
      Array.from({ length: 8 }, (_, i) => ({
        kind: 'INDEX_INCIDENT' as const,
        subjectKey: `i${i}`,
      }))
    );
    let active = 0;
    let peak = 0;
    const handler: WorkHandler = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
    };
    const result = await runIntelligenceCycle(createLaneState(), {
      getCriticalLagMs: noLag,
      handlers: { INDEX_INCIDENT: handler },
    });
    expect(result.completed).toBe(8);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('runs lane work on its own pool in a shared process, and on the process pool otherwise', async () => {
    await enable();
    await enqueueWorkItems([
      { kind: 'INDEX_INCIDENT', subjectKey: 'own-pool' },
      { kind: 'INDEX_INCIDENT', subjectKey: 'shared-pool' },
    ]);
    const seen: Record<string, string> = {};
    const handler: WorkHandler = async item => {
      const [row] = await prisma.$queryRaw<Array<{ name: string }>>`
        SELECT current_setting('application_name') AS name`;
      seen[item.subjectKey] = row.name;
    };
    const [primary] = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_setting('application_name') AS name`;
    await db.intelligenceWorkItem.updateMany({
      where: { subjectKey: 'shared-pool' },
      data: { scheduledAt: new Date(Date.now() + 60_000) },
    });
    // Default plan: the test process has the integrated role, so the lane has its own pool.
    expect(
      await runIntelligenceCycle(createLaneState(), {
        getCriticalLagMs: noLag,
        handlers: { INDEX_INCIDENT: handler },
      })
    ).toMatchObject({ completed: 1 });
    await db.intelligenceWorkItem.updateMany({
      where: { subjectKey: 'shared-pool' },
      data: { scheduledAt: new Date(0) },
    });
    expect(
      await runIntelligenceCycle(createLaneState(), {
        getCriticalLagMs: noLag,
        handlers: { INDEX_INCIDENT: handler },
        lanePool: { ownPool: false, size: 0 },
      })
    ).toMatchObject({ completed: 1 });
    expect(seen['own-pool']).toBe('opsknight-intelligence-lane');
    expect(seen['shared-pool']).toBe(primary.name);
    // Ingestion's pool is untouched by the lane's workload.
    const [after] = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_setting('application_name') AS name`;
    expect(after.name).toBe(primary.name);
  });

  it('runs one item at a time and paces itself while ingestion in this process is busy', async () => {
    await enable({ maxConcurrency: 4, batchSize: 10 });
    await enqueueWorkItems(
      Array.from({ length: 6 }, (_, i) => ({
        kind: 'INDEX_INCIDENT' as const,
        subjectKey: `busy-${i}`,
      }))
    );
    // A synthetic, constantly busy ingestion: eight events in flight on every reading.
    const started = performance.now();
    const source = () => {
      const at = performance.now() - started + 1_000;
      return { inFlight: 8, integralMs: 8 * at, at };
    };
    const slept: number[] = [];
    const state = createLaneState();
    state.ingestionYield = new IngestionYield(
      source,
      { sampleMs: 0, duty: 0.5, maxPauseMs: 40, pollMs: 10 },
      async ms => {
        slept.push(ms);
        await new Promise(resolve => setTimeout(resolve, ms));
      }
    );
    let active = 0;
    let peak = 0;
    const handler: WorkHandler = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
    };
    const result = await runIntelligenceCycle(state, {
      getCriticalLagMs: noLag,
      handlers: { INDEX_INCIDENT: handler },
    });
    expect(result).toMatchObject({ status: 'worked', claimed: 1, completed: 1 });
    expect(peak).toBe(1);
    expect(slept.length).toBeGreaterThan(0);
    expect(state.ingestionYield.pausedMs).toBeGreaterThan(0);
    // Queued work stays queued, untouched, for the next paced cycle.
    expect(await db.intelligenceWorkItem.count({ where: { attempts: 0 } })).toBe(5);

    // Once ingestion is quiet the lane returns to its configured concurrency and batch size.
    const quiet = createLaneState();
    const after = await runIntelligenceCycle(quiet, {
      getCriticalLagMs: noLag,
      handlers: { INDEX_INCIDENT: handler },
    });
    expect(after).toMatchObject({ claimed: 5, completed: 5 });
    expect(peak).toBeGreaterThan(1);
  });

  it('reads settings on the lane pool once it has opened it, never again on the ingestion pool', async () => {
    await enable();
    // The process (ingestion) client; the lane's own pool is a different client.
    const primary = globalThis.prismaGlobal!;
    const spy = vi.spyOn(primary.intelligenceSettings, 'findUnique');
    const state = createLaneState();
    state.ingestionYield = undefined;
    const dependencies = {
      getCriticalLagMs: noLag,
      getPoolWaitingQueries: async () => 0,
      handlers: {},
      lanePool: { ownPool: true, size: 4 },
    };
    try {
      expect((await runIntelligenceCycle(state, dependencies)).status).toBe('idle');
      // One pre-read decides whether to open the lane pool at all (a disabled install never opens it).
      expect(spy).toHaveBeenCalledTimes(1);
      expect(state.lanePoolOpened).toBe(true);
      spy.mockClear();
      for (let cycle = 0; cycle < 3; cycle += 1) await runIntelligenceCycle(state, dependencies);
      expect(spy).not.toHaveBeenCalled();
      // A lane that is switched off later still reads the flag on its own pool.
      await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
      expect((await runIntelligenceCycle(state, dependencies)).status).toBe('disabled');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('waits the back-off floor after a pool-pressure pause while ingestion is busy, not a tight loop', async () => {
    await enable();
    const started = performance.now();
    const busy = () => {
      const at = performance.now() - started + 1_000;
      return { inFlight: 8, integralMs: 8 * at, at };
    };
    const slept: number[] = [];
    const state = createLaneState();
    state.ingestionYield = new IngestionYield(
      busy,
      { sampleMs: 0, backoffFloorMs: 80, pollMs: 20 },
      async ms => {
        slept.push(ms);
      }
    );
    const pressured = {
      getCriticalLagMs: noLag,
      getPoolWaitingQueries: async () => 3,
      handlers: {},
    };
    expect((await runIntelligenceCycle(state, pressured)).status).toBe('paused');
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(80);

    // With ingestion quiet the pause does not wait: production already waits 5 s after `paused`.
    const quietSlept: number[] = [];
    const quiet = createLaneState();
    quiet.ingestionYield = new IngestionYield(
      () => ({ inFlight: 0, integralMs: 0, at: performance.now() }),
      { sampleMs: 0, backoffFloorMs: 80, pollMs: 20 },
      async ms => {
        quietSlept.push(ms);
      }
    );
    expect((await runIntelligenceCycle(quiet, pressured)).status).toBe('paused');
    expect(quietSlept).toEqual([]);
  });

  it('never throws even if the database settings read fails', async () => {
    const spy = vi
      .spyOn(prisma.intelligenceSettings, 'findUnique')
      .mockRejectedValueOnce(new Error('db down'));
    try {
      const result = await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: noLag });
      expect(result.status).toBe('idle');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

it('isolates the lane when a dedicated worker owns analysis', () => {
  expect(shouldRunIntelligenceLane('general-worker', true)).toBe(false);
  expect(shouldRunIntelligenceLane('integrated', true)).toBe(false);
  expect(shouldRunIntelligenceLane('intelligence-worker', true)).toBe(true);
});

it('expires saved chats even when the Intelligence engine has never been configured', async () => {
  const { recordExchange } = await import('@/lib/intelligence/conversations/store');
  const user = await db.user.create({
    data: {
      email: 'history-only@example.com',
      name: 'History only',
      passwordHash: 'x',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireHistoryEnabled: true,
      squireHistoryRetentionDays: 90,
    },
  });
  const id = await recordExchange({
    userId: user.id,
    question: 'An old chat',
    answer: 'Saved without AI.',
  });
  await db.$executeRaw`UPDATE "SquireConversation" SET "updatedAt" = now() - interval '91 days' WHERE "id" = ${id}`;
  expect(await db.intelligenceSettings.count()).toBe(0);
  expect(await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: noLag })).toMatchObject({
    status: 'disabled',
    claimed: 0,
  });
  expect(await db.squireConversation.findUnique({ where: { id } })).toBeNull();
});

describe('a lane standing in for a parked lane thread', () => {
  it('idles while disabled and never asks for the hand-off', async () => {
    const handOff = vi.fn();
    const result = await runIntelligenceCycle(createLaneState(), {
      getCriticalLagMs: noLag,
      handOffWhenEnabled: handOff,
      handlers: {},
    });
    expect(result.status).toBe('disabled');
    expect(handOff).not.toHaveBeenCalled();
  });

  it('hands off instead of working once intelligence is enabled', async () => {
    await enable();
    const service = await createTestService('stand-in');
    const incident = await createTestIncident('stand-in incident', service.id);
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: incident.id, priority: 100 }]);
    const handOff = vi.fn();
    const handler = vi.fn(async () => {});
    const state = createLaneState();
    const result = await runIntelligenceCycle(state, {
      getCriticalLagMs: noLag,
      handOffWhenEnabled: handOff,
      handlers: { INDEX_INCIDENT: handler as unknown as WorkHandler },
    });
    expect(handOff).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'idle', claimed: 0, completed: 0 });
    // Nothing was claimed and the lane pool of this thread was never opened: the thread owns the work.
    expect(state.lanePoolOpened).toBeFalsy();
    expect(await db.intelligenceWorkItem.count({ where: { claimedAt: { not: null } } })).toBe(0);
  });
});

describe('lane mode in /metrics', () => {
  it('reports where the lane runs and singles out an integrated fallback', async () => {
    const { collectIntelligenceMetrics } = await import('@/lib/intelligence/metrics');
    const { setIntelligenceLaneMode } = await import('@/lib/intelligence/jobs/runner');
    startIntelligenceLane({ initialDelayMs: 60_000 });
    try {
      const pick = async () => {
        const samples = await collectIntelligenceMetrics();
        return {
          mode: samples.filter(sample => sample.name === 'opsknight_intelligence_lane_mode'),
          fallback: samples.find(
            sample => sample.name === 'opsknight_intelligence_lane_thread_fallback'
          )?.value,
        };
      };
      // A worker role: in-process by design, not a fallback.
      expect(await pick()).toEqual({
        mode: [
          { name: 'opsknight_intelligence_lane_mode', value: 1, labels: { mode: 'in-process' } },
        ],
        fallback: 0,
      });
      setIntelligenceLaneMode({ mode: 'in-process', fallbackReason: 'bundle-missing' });
      expect(await pick()).toMatchObject({ fallback: 1 });
      expect(getIntelligenceLaneStatus()).toMatchObject({
        mode: 'in-process',
        fallbackReason: 'bundle-missing',
      });
      setIntelligenceLaneMode({ mode: 'thread', fallbackReason: null });
      expect(await pick()).toEqual({
        mode: [{ name: 'opsknight_intelligence_lane_mode', value: 1, labels: { mode: 'thread' } }],
        fallback: 0,
      });
    } finally {
      setIntelligenceLaneMode(undefined);
      await stopIntelligenceLane();
    }
  });
});
