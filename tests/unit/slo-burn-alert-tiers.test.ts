import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  burnOf,
  firingTier,
  joinSli,
  nextAlertState,
  sumByBucket,
  windowBurns,
  type AlertMachineState,
  type SliPoint,
} from '@/lib/slo/burn-alerts/tiers';
import type { SloBurnByWindow } from '@/lib/slo/burn-alerts/contract';

const STEP = 300_000;
const END = Date.UTC(2026, 10, 21, 12, 0, 0);
const MIN = 60_000;
const FULL = 3 * 1440; // coverage spanning the longest window, in minutes

const burns = (values: Partial<SloBurnByWindow>): SloBurnByWindow => ({
  '5m': null,
  '30m': null,
  '1h': null,
  '2h': null,
  '6h': null,
  '1d': null,
  '3d': null,
  ...values,
});
const all = (value: number) =>
  burns({
    '5m': value,
    '30m': value,
    '1h': value,
    '2h': value,
    '6h': value,
    '1d': value,
    '3d': value,
  });

describe('burnOf', () => {
  it.each([
    // [good, total, target, expected]
    [999, 1000, 99.9, 1],
    [990, 1000, 99.9, 10],
    [1000, 1000, 99.9, 0],
    [0, 1000, 99, 100],
  ])('good %d of %d at %d%% burns %d×', (good, total, target, expected) => {
    expect(burnOf(good, total, target)).toBe(expected);
  });

  it('is null without events: no traffic is not an outage', () => {
    expect(burnOf(0, 0, 99.9)).toBeNull();
  });

  it('never goes negative when good exceeds total', () => {
    expect(burnOf(1200, 1000, 99.9)).toBe(0);
  });
});

describe('firingTier', () => {
  it.each([
    // [label, burns, expected tier]
    ['fast page: 1h and 5m at 14.4', burns({ '1h': 14.4, '5m': 15 }), 'PAGE'],
    ['slow page: 6h and 30m at 6', burns({ '6h': 6, '30m': 7 }), 'PAGE'],
    ['fast ticket: 1d and 2h at 3', burns({ '1d': 3, '2h': 3.5 }), 'TICKET'],
    ['slow ticket: 3d and 6h at 1', burns({ '3d': 1, '6h': 1.2 }), 'TICKET'],
    ['long window only (spike stopped)', burns({ '1h': 20, '5m': 0 }), 'OK'],
    ['short window only (blip)', burns({ '1h': 2, '5m': 50 }), 'OK'],
    [
      'just under every threshold',
      burns({ '1h': 14.39, '5m': 14.39, '6h': 5.99, '30m': 5.99 }),
      'OK',
    ],
    ['page outranks ticket', all(20), 'PAGE'],
    ['no events anywhere', burns({}), 'OK'],
  ] as const)('%s', (_label, values, expected) => {
    expect(firingTier(values, FULL, true).target).toBe(expected);
  });

  it('arms a tier only once coverage spans its long window', () => {
    const burning = all(20);
    expect(firingTier(burning, 59, true)).toEqual({ target: 'OK', armed: 0 });
    expect(firingTier(burning, 60, true)).toEqual({ target: 'PAGE', armed: 1 });
    const slowTicket = burns({ '3d': 2, '6h': 2 });
    expect(firingTier(slowTicket, 1440, true)).toEqual({ target: 'OK', armed: 3 });
    expect(firingTier(slowTicket, FULL, true)).toEqual({ target: 'TICKET', armed: 4 });
  });

  it('never opens a ticket when tickets are off, but still pages', () => {
    expect(firingTier(burns({ '1d': 5, '2h': 5 }), FULL, false).target).toBe('OK');
    expect(firingTier(all(20), FULL, false).target).toBe('PAGE');
  });

  it('does not fire when a window had no events (total = 0)', () => {
    expect(firingTier(burns({ '1h': 30, '5m': null }), FULL, true).target).toBe('OK');
  });
});

describe('nextAlertState (hysteresis)', () => {
  it('escalates at once, including ticket to page', () => {
    expect(nextAlertState({ state: 'OK', belowStreak: 0 }, 'PAGE')).toEqual({
      state: 'PAGE',
      belowStreak: 0,
    });
    expect(nextAlertState({ state: 'TICKET', belowStreak: 2 }, 'PAGE')).toEqual({
      state: 'PAGE',
      belowStreak: 0,
    });
  });

  it('steps down only after three clean evaluations in a row', () => {
    let current: AlertMachineState = { state: 'PAGE', belowStreak: 0 };
    current = nextAlertState(current, 'OK');
    expect(current).toEqual({ state: 'PAGE', belowStreak: 1 });
    current = nextAlertState(current, 'OK');
    expect(current).toEqual({ state: 'PAGE', belowStreak: 2 });
    current = nextAlertState(current, 'OK');
    expect(current).toEqual({ state: 'OK', belowStreak: 0 });
  });

  it('restarts the streak when the burn comes back', () => {
    let current = nextAlertState({ state: 'TICKET', belowStreak: 0 }, 'OK');
    current = nextAlertState(current, 'OK');
    current = nextAlertState(current, 'TICKET');
    expect(current).toEqual({ state: 'TICKET', belowStreak: 0 });
    current = nextAlertState(current, 'OK');
    expect(current).toEqual({ state: 'TICKET', belowStreak: 1 });
  });

  it('steps a page down to a ticket while the slow burn continues', () => {
    let current = nextAlertState({ state: 'PAGE', belowStreak: 0 }, 'TICKET');
    current = nextAlertState(current, 'TICKET');
    current = nextAlertState(current, 'TICKET');
    expect(current).toEqual({ state: 'TICKET', belowStreak: 0 });
  });
});

describe('windowBurns and bucketing', () => {
  const steady = (from: number, count: number, good: number, total: number): SliPoint[] =>
    Array.from({ length: count }, (_, index) => ({ at: from + index * STEP, good, total }));

  it('sums only the steps that start inside each window', () => {
    // Three days at 99.9% (burn 1×), then the last hour at 98% (burn 20×).
    const points = [
      ...steady(END - 3 * 1440 * MIN, 3 * 288 - 12, 999, 1000),
      ...steady(END - 60 * MIN, 12, 980, 1000),
    ];
    const result = windowBurns(points, END, 99.9);
    expect(result['5m']).toBe(20);
    expect(result['1h']).toBe(20);
    // (852 × 1 + 12 × 20 bad) of 864,000 = 0.1264%, over a 0.1% budget.
    expect(result['3d']).toBe(1.26);
    expect(firingTier(result, FULL, true).target).toBe('PAGE');
  });

  it('attributes a point at t to the step ending at t and adds every series', () => {
    expect(bucketOf(END, STEP)).toBe(END - STEP);
    const sums = sumByBucket(
      [
        {
          points: [
            [END, 5],
            [END - STEP, 4],
          ],
        },
        {
          points: [
            [END, 1],
            [END, Number.NaN],
            [END, -3],
          ],
        },
      ],
      STEP,
      END - 2 * STEP,
      END
    );
    expect([...sums.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [END - 2 * STEP, 4],
      [END - STEP, 6],
    ]);
  });

  it('drops steps without a total and caps good at total', () => {
    const good = new Map([
      [1, 5],
      [2, 9],
    ]);
    const total = new Map([[2, 8]]);
    expect(joinSli(good, total)).toEqual([{ at: 2, good: 8, total: 8 }]);
  });
});
