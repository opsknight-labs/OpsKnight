import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEAD_LETTER_REVIVE_MS,
  MAX_WORK_ATTEMPTS,
  claimWorkItems,
  completeWorkItem,
  computeRetryDelayMs,
  enqueueWorkItems,
  failWorkItem,
  getWorkBacklog,
  listDeadLetters,
  purgeDeadLetters,
  renewWorkItemLease,
  replayDeadLetter,
} from '@/lib/intelligence/jobs/work-queue';
import { resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const item = (subjectKey: string, extra: { priority?: number; scheduledAt?: Date } = {}) => ({
  kind: 'INDEX_INCIDENT' as const,
  subjectKey,
  ...extra,
});

describe('work item coalescing', () => {
  it('turns an alert storm into one row per subject and counts the signals', async () => {
    await enqueueWorkItems([item('inc-1')]);
    const first = (await db.intelligenceWorkItem.findFirstOrThrow()).generation;
    for (let i = 0; i < 4; i += 1) await enqueueWorkItems([item('inc-1')]);
    const rows = await db.intelligenceWorkItem.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].generation).toBeGreaterThan(first);
  });

  it('accepts batches larger than one statement can carry', async () => {
    const subjects = Array.from({ length: 9_000 }, (_, i) => item(`bulk-${i}`));
    expect(await enqueueWorkItems(subjects)).toBe(9_000);
    expect(await db.intelligenceWorkItem.count()).toBe(9_000);
  });

  it('tolerates duplicate subjects inside a single batch', async () => {
    await enqueueWorkItems([item('a'), item('a'), item('b')]);
    expect(await db.intelligenceWorkItem.count()).toBe(2);
  });

  it('keeps the highest priority and earliest schedule when re-signalled', async () => {
    const early = new Date(Date.now() - 60_000);
    await enqueueWorkItems([
      item('a', { priority: 50, scheduledAt: new Date(Date.now() + 60_000) }),
    ]);
    await enqueueWorkItems([item('a', { priority: 5, scheduledAt: early })]);
    const row = await db.intelligenceWorkItem.findFirstOrThrow();
    expect(row.priority).toBe(5);
    expect(row.scheduledAt.getTime()).toBe(early.getTime());
  });

  it('does nothing for an empty batch', async () => {
    expect(await enqueueWorkItems([])).toBe(0);
  });
});

describe('claiming', () => {
  it('serves higher priority first and honours the limit', async () => {
    await enqueueWorkItems([
      item('low', { priority: 90 }),
      item('high', { priority: 1 }),
      item('mid', { priority: 50 }),
    ]);
    const claimed = await claimWorkItems({ limit: 2 });
    expect(claimed.map(c => c.subjectKey)).toEqual(['high', 'mid']);
    expect(claimed.every(c => c.attempts === 1 && c.claimToken)).toBe(true);
  });

  it('does not hand out an item that is currently leased', async () => {
    await enqueueWorkItems([item('a')]);
    expect(await claimWorkItems({ limit: 5 })).toHaveLength(1);
    expect(await claimWorkItems({ limit: 5 })).toHaveLength(0);
  });

  it('never gives the same item to two concurrent workers (SKIP LOCKED)', async () => {
    await enqueueWorkItems(Array.from({ length: 60 }, (_, i) => item(`inc-${i}`)));
    const batches = await Promise.all(
      Array.from({ length: 6 }, () => claimWorkItems({ limit: 15 }))
    );
    const ids = batches.flat().map(c => c.id);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
  });

  it('re-claims work after a worker dies and its lease expires', async () => {
    await enqueueWorkItems([item('a')]);
    const [first] = await claimWorkItems({ limit: 1 });
    await db.intelligenceWorkItem.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const [second] = await claimWorkItems({ limit: 1 });
    expect(second.id).toBe(first.id);
    expect(second.attempts).toBe(2);
    expect(second.claimToken).not.toBe(first.claimToken);
    // The dead worker's late completion is fenced out by its stale claim token.
    expect(await completeWorkItem(first)).toBe('lost');
    expect(await db.intelligenceWorkItem.count()).toBe(1);
  });

  it('lets a live worker extend its lease and detects a lost claim', async () => {
    await enqueueWorkItems([item('a')]);
    const [claimed] = await claimWorkItems({ limit: 1, leaseMs: 1000 });
    expect(await renewWorkItemLease(claimed, 60_000)).toBe(true);
    expect(await renewWorkItemLease({ id: claimed.id, claimToken: 'stale' })).toBe(false);
  });
});

describe('completion and generations', () => {
  it('removes finished work', async () => {
    await enqueueWorkItems([item('a')]);
    const [claimed] = await claimWorkItems({ limit: 1 });
    expect(await completeWorkItem(claimed)).toBe('completed');
    expect(await db.intelligenceWorkItem.count()).toBe(0);
  });

  it('keeps work signalled while it was running and runs it again', async () => {
    await enqueueWorkItems([item('a')]);
    const [claimed] = await claimWorkItems({ limit: 1 });
    await enqueueWorkItems([item('a')]); // new data arrived mid-run
    expect(await completeWorkItem(claimed)).toBe('requeued');
    const [again] = await claimWorkItems({ limit: 1 });
    expect(again.subjectKey).toBe('a');
    expect(again.generation).toBeGreaterThan(claimed.generation);
    expect(again.attempts).toBe(1);
  });

  it('never reuses a generation after finished work is deleted and the subject is signalled again', async () => {
    await enqueueWorkItems([item('a')]);
    await enqueueWorkItems([item('a')]);
    const [first] = await claimWorkItems({ limit: 1 });
    expect(await completeWorkItem(first)).toBe('completed');
    expect(await db.intelligenceWorkItem.count()).toBe(0);

    await enqueueWorkItems([item('a')]);
    const [second] = await claimWorkItems({ limit: 1 });
    // A restarted counter would make the new analysis look older than findings already written.
    expect(second.generation).toBeGreaterThan(first.generation);
  });
});

describe('failure handling and dead letters', () => {
  it('backs off after a failure instead of retrying immediately', async () => {
    await enqueueWorkItems([item('a')]);
    const [claimed] = await claimWorkItems({ limit: 1 });
    expect(await failWorkItem(claimed, new Error('boom'))).toBe(true);
    expect(await claimWorkItems({ limit: 1 })).toHaveLength(0);
    const row = await db.intelligenceWorkItem.findFirstOrThrow();
    expect(row.lastError).toBe('boom');
    expect(row.scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('quarantines poison work at the attempt ceiling and allows operator replay', async () => {
    await enqueueWorkItems([item('poison')]);
    for (let attempt = 1; attempt <= MAX_WORK_ATTEMPTS; attempt += 1) {
      await db.intelligenceWorkItem.updateMany({
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });
      const [claimed] = await claimWorkItems({ limit: 1 });
      expect(claimed.attempts).toBe(attempt);
      await failWorkItem(claimed, new Error('always fails'));
    }
    await db.intelligenceWorkItem.updateMany({
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    expect(await claimWorkItems({ limit: 1 })).toHaveLength(0);

    const backlog = await getWorkBacklog();
    expect(backlog).toMatchObject({ deadLetters: 1, ready: 0 });
    const [dead] = await listDeadLetters();
    expect(dead).toMatchObject({
      subjectKey: 'poison',
      attempts: MAX_WORK_ATTEMPTS,
      lastError: 'always fails',
    });

    expect(await replayDeadLetter(dead.id)).toBe(true);
    expect(await claimWorkItems({ limit: 1 })).toHaveLength(1);
  });

  async function deadLetter(subjectKey: string) {
    await enqueueWorkItems([item(subjectKey)]);
    for (let attempt = 1; attempt <= MAX_WORK_ATTEMPTS; attempt += 1) {
      await db.intelligenceWorkItem.updateMany({
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });
      const [claimed] = await claimWorkItems({ limit: 1 });
      await failWorkItem(claimed, new Error('database unavailable'));
    }
    const row = await db.intelligenceWorkItem.findFirstOrThrow({ where: { subjectKey } });
    expect(row.attempts).toBe(MAX_WORK_ATTEMPTS);
    expect(row.failedAt).not.toBeNull();
    return row;
  }

  it('revives a dead letter that is signalled again after the cool-down, so an outage cannot stop work for good', async () => {
    await deadLetter('outage');
    await db.intelligenceWorkItem.updateMany({
      data: {
        failedAt: new Date(Date.now() - DEAD_LETTER_REVIVE_MS - 1000),
        scheduledAt: new Date(Date.now() - 1000),
      },
    });
    await enqueueWorkItems([item('outage')]);
    const [claimed] = await claimWorkItems({ limit: 1 });
    expect(claimed).toMatchObject({ subjectKey: 'outage', attempts: 1 });
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).failedAt).toBeNull();
  });

  it('does not revive a dead letter signalled again inside the cool-down', async () => {
    await deadLetter('poison');
    await enqueueWorkItems([item('poison')]);
    await db.intelligenceWorkItem.updateMany({
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    expect(await claimWorkItems({ limit: 1 })).toHaveLength(0);
  });

  it('drops old dead letters during retention and keeps live work', async () => {
    await deadLetter('old');
    await db.intelligenceWorkItem.updateMany({
      data: { failedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await enqueueWorkItems([item('live')]);
    expect(await purgeDeadLetters(7 * 86_400_000, 100)).toBe(1);
    expect((await db.intelligenceWorkItem.findMany()).map(row => row.subjectKey)).toEqual(['live']);
  });

  it('claims an item whose lease expired, and never one whose lease is live', async () => {
    await enqueueWorkItems([item('a'), item('b')]);
    const claimed = await claimWorkItems({ limit: 2, leaseMs: 60_000 });
    expect(claimed).toHaveLength(2);
    expect(await claimWorkItems({ limit: 2 })).toHaveLength(0);
    await db.intelligenceWorkItem.updateMany({
      where: { subjectKey: 'a' },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const reclaimed = await claimWorkItems({ limit: 2 });
    expect(reclaimed.map(row => row.subjectKey)).toEqual(['a']);
    expect(reclaimed[0].claimToken).not.toBe(
      claimed.find(row => row.subjectKey === 'a')!.claimToken
    );
  });

  it('truncates very long error messages', async () => {
    await enqueueWorkItems([item('a')]);
    const [claimed] = await claimWorkItems({ limit: 1 });
    await failWorkItem(claimed, new Error('x'.repeat(10_000)));
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).lastError?.length).toBe(1000);
  });
});

describe('backlog statistics', () => {
  it('reports ready, leased and oldest age', async () => {
    await enqueueWorkItems([
      item('a', { scheduledAt: new Date(Date.now() - 5000) }),
      item('b'),
      item('c'),
    ]);
    await claimWorkItems({ limit: 1 });
    const backlog = await getWorkBacklog();
    expect(backlog.leased).toBe(1);
    expect(backlog.ready).toBe(2);
    expect(backlog.oldestReadyAgeMs).not.toBeNull();
  });
});

describe('retry delay', () => {
  it('grows exponentially with jitter and is capped', () => {
    const lowest = (attempts: number) => computeRetryDelayMs(attempts, () => 0);
    const highest = (attempts: number) => computeRetryDelayMs(attempts, () => 0.999999);
    expect(lowest(1)).toBe(2500);
    expect(highest(1)).toBeLessThanOrEqual(5000);
    expect(lowest(4)).toBeGreaterThan(lowest(2));
    expect(highest(50)).toBeLessThanOrEqual(15 * 60_000);
    expect(lowest(50)).toBeGreaterThanOrEqual(7.5 * 60_000);
  });
});

it('makes default schedules and operator replay immediately due despite application clock skew', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.now() + 300000));
  try {
    await enqueueWorkItems([item('clock-skew')]);
    const [claimed] = await claimWorkItems({ limit: 1 });
    expect(claimed?.subjectKey).toBe('clock-skew');
    await db.intelligenceWorkItem.update({
      where: { id: claimed.id },
      data: { attempts: MAX_WORK_ATTEMPTS },
    });
    expect(await replayDeadLetter(claimed.id)).toBe(true);
    expect((await claimWorkItems({ limit: 1 }))[0]?.subjectKey).toBe('clock-skew');
  } finally {
    vi.useRealTimers();
  }
});
