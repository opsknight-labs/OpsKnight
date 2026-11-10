import { describe, expect, it, vi } from 'vitest';
import {
  configureIntelligenceLanePrismaDatasource,
  DEFAULT_INTELLIGENCE_LANE_POOL_SIZE,
  intelligenceLanePoolSize,
  isIntelligenceLaneThread,
} from '@/lib/prisma-datasource';
import { isIntelligenceDatabaseWorkload, withIntelligenceDatabase } from '@/lib/database-workload';
import { laneConcurrency, resolveLanePool, runOnLanePool } from '@/lib/intelligence/jobs/lane-pool';

vi.mock('server-only', () => ({}));

describe('intelligence lane pool', () => {
  it('reads its size from the environment, with 0 meaning the shared process pool', () => {
    expect(intelligenceLanePoolSize(undefined)).toBe(DEFAULT_INTELLIGENCE_LANE_POOL_SIZE);
    expect(intelligenceLanePoolSize('')).toBe(DEFAULT_INTELLIGENCE_LANE_POOL_SIZE);
    expect(intelligenceLanePoolSize('0')).toBe(0);
    expect(intelligenceLanePoolSize('1')).toBe(2);
    expect(intelligenceLanePoolSize(' 6 ')).toBe(6);
    for (const invalid of ['-1', '2.5', 'many', '17']) {
      expect(intelligenceLanePoolSize(invalid)).toBe(DEFAULT_INTELLIGENCE_LANE_POOL_SIZE);
    }
  });

  it('gets its own pool only where it shares a process with ingestion and paging', () => {
    for (const role of ['integrated', 'worker', 'general-worker']) {
      expect(resolveLanePool(role, 10)).toEqual({ ownPool: true, size: 10 });
    }
    // The dedicated role is the lane alone: it keeps the process pool and is unaffected.
    expect(resolveLanePool('intelligence-worker', 10)).toEqual({ ownPool: false, size: 0 });
    expect(resolveLanePool('integrated', 0)).toEqual({ ownPool: false, size: 0 });
  });

  it('treats a lane thread client as the lane pool: no per-call switch, concurrency still capped', () => {
    expect(isIntelligenceLaneThread('1')).toBe(true);
    expect(isIntelligenceLaneThread(undefined)).toBe(false);
    expect(isIntelligenceLaneThread('true')).toBe(false);
    const thread = resolveLanePool('integrated', 6, true);
    expect(thread).toEqual({ ownPool: false, size: 6 });
    expect(laneConcurrency(thread, 16)).toBe(4);
    // INTELLIGENCE_LANE_DATABASE_POOL_SIZE=0 only means "shared" in-process; a thread always has its own.
    expect(resolveLanePool('integrated', 0, true)).toEqual({
      ownPool: false,
      size: DEFAULT_INTELLIGENCE_LANE_POOL_SIZE,
    });
    expect(resolveLanePool('integrated', 10, false)).toEqual({ ownPool: true, size: 10 });
  });

  it('keeps handler concurrency below its own pool so handlers never queue on each other', () => {
    const own = resolveLanePool('integrated', 10);
    expect(laneConcurrency(own, 2)).toBe(2);
    expect(laneConcurrency(own, 16)).toBe(8);
    expect(laneConcurrency(resolveLanePool('integrated', 2), 4)).toBe(1);
    // On the shared pool the operator's setting applies unchanged.
    expect(laneConcurrency(resolveLanePool('intelligence-worker', 10), 16)).toBe(16);
  });

  it('routes work into the intelligence workload only when the lane has its own pool', async () => {
    expect(isIntelligenceDatabaseWorkload()).toBe(false);
    expect(
      await runOnLanePool({ ownPool: true, size: 4 }, async () => {
        await Promise.resolve();
        return isIntelligenceDatabaseWorkload();
      })
    ).toBe(true);
    expect(
      await runOnLanePool({ ownPool: false, size: 0 }, async () => isIntelligenceDatabaseWorkload())
    ).toBe(false);
    expect(isIntelligenceDatabaseWorkload()).toBe(false);
    await withIntelligenceDatabase(async () => expect(isIntelligenceDatabaseWorkload()).toBe(true));
  });

  it('configures the lane datasource with its own limit and a recognisable name', () => {
    const url = new URL(
      configureIntelligenceLanePrismaDatasource('postgresql://db/app?connection_limit=40', 4)!
    );
    expect(url.searchParams.getAll('connection_limit')).toEqual(['4']);
    expect(url.searchParams.get('application_name')).toBe('opsknight-intelligence-lane');
    const named = new URL(
      configureIntelligenceLanePrismaDatasource('postgresql://db/app?application_name=mine', 4)!
    );
    expect(named.searchParams.get('application_name')).toBe('mine');
    expect(configureIntelligenceLanePrismaDatasource(undefined, 4)).toBeUndefined();
  });
});
