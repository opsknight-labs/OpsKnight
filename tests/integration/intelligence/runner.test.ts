import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { evaluatePause } from '@/lib/intelligence/jobs/backpressure';
import { enqueueWorkItems } from '@/lib/intelligence/jobs/work-queue';
import { DISCOVERY_SAFETY_LAG_MS } from '@/lib/intelligence/jobs/discovery';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  runIntelligenceCycle,
  type WorkHandler,
} from '@/lib/intelligence/jobs/runner';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import type { IntelligenceSettingsView } from '@/lib/intelligence/settings/service';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function enable(overrides: Partial<IntelligenceSettingsView> = {}) {
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, ...overrides },
  });
}

const noLag = async () => 0;

describe('backpressure hysteresis', () => {
  it('pauses above the threshold and resumes only below half of it', () => {
    expect(evaluatePause({ paused: false }, 14_000, 15_000)).toEqual({ paused: false, changed: false });
    expect(evaluatePause({ paused: false }, 16_000, 15_000)).toEqual({ paused: true, changed: true });
    expect(evaluatePause({ paused: true }, 10_000, 15_000)).toEqual({ paused: true, changed: false });
    expect(evaluatePause({ paused: true }, 7_000, 15_000)).toEqual({ paused: false, changed: true });
  });
});

describe('intelligence cycle', () => {
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
    expect((await runIntelligenceCycle(state, { getCriticalLagMs: async () => 10_000 })).status).toBe('paused');
    expect((await runIntelligenceCycle(state, { getCriticalLagMs: async () => 1_000 })).status).not.toBe('paused');
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

    expect(result).toMatchObject({ status: 'worked', discovered: 1, claimed: 1, completed: 1, failed: 0 });
    const fingerprint = await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: created.id } });
    expect(fingerprint.template).toBe('latency high on api-<num>');
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
    expect(remaining).toMatchObject({ subjectKey: 'bad', lastError: 'handler exploded' });
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
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).lastError).toMatch(/exceeded its 100ms budget/);
  });

  it('fails work with no registered handler instead of dropping it', async () => {
    await enable();
    await db.intelligenceWorkItem.create({ data: { kind: 'UNKNOWN_KIND', subjectKey: 'x' } });
    const result = await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: noLag, handlers: DEFAULT_HANDLERS });
    expect(result.failed).toBe(1);
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).lastError).toMatch(/No handler registered/);
  });

  it('never exceeds the configured concurrency', async () => {
    await enable({ maxConcurrency: 2, batchSize: 10 });
    await enqueueWorkItems(Array.from({ length: 8 }, (_, i) => ({ kind: 'INDEX_INCIDENT' as const, subjectKey: `i${i}` })));
    let active = 0;
    let peak = 0;
    const handler: WorkHandler = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
    };
    const result = await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: noLag, handlers: { INDEX_INCIDENT: handler } });
    expect(result.completed).toBe(8);
    expect(peak).toBeLessThanOrEqual(2);
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
