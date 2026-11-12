import { describe, expect, it } from 'vitest';
import { buildCoverageDays, findCoverageGapDays } from '@/lib/oncall-load/coverage';
import {
  bucketInstant,
  computeLoad,
  isNightHour,
  localHour,
  type PageBucket,
} from '@/lib/oncall-load/metrics';
import {
  coverageGapInsights,
  ONCALL_INSIGHT_KINDS,
  samePersonPrimarySecondaryInsights,
  sustainedNightLoadInsights,
  unfairRotationInsights,
  upcomingShiftHeavyInsights,
} from '@/lib/oncall-load/insights';

const at = (iso: string) => new Date(iso);
const WEEK = 7 * 24 * 3600;

describe('buildCoverageDays', () => {
  it('splits a block at midnight in the schedule time zone and keeps layers apart', () => {
    const rows = buildCoverageDays(
      [
        // 18:00 on the 1st to 06:00 on the 2nd, New York time (UTC-5 in January).
        { start: at('2026-01-01T23:00:00Z'), end: at('2026-01-02T11:00:00Z'), userId: 'u1', layerId: 'l1' },
        { start: at('2026-01-02T11:00:00Z'), end: at('2026-01-02T13:00:00Z'), userId: 'u1', layerId: 'l2' },
      ],
      'America/New_York',
      '2026-01-01',
      '2026-01-03'
    );
    expect(rows).toEqual([
      { date: '2026-01-01', userId: 'u1', layerId: 'l1', seconds: 6 * 3600 },
      { date: '2026-01-02', userId: 'u1', layerId: 'l1', seconds: 6 * 3600 },
      { date: '2026-01-02', userId: 'u1', layerId: 'l2', seconds: 2 * 3600 },
    ]);
  });

  it('counts the real length of a DST day', () => {
    const block = { start: at('2026-03-01T00:00:00Z'), end: at('2026-04-01T00:00:00Z'), userId: 'u1', layerId: 'l1' };
    const [springForward] = buildCoverageDays([block], 'America/New_York', '2026-03-08', '2026-03-09');
    expect(springForward.seconds).toBe(23 * 3600);
  });

  it('ignores blocks outside the range', () => {
    expect(
      buildCoverageDays(
        [{ start: at('2026-01-05T00:00:00Z'), end: at('2026-01-06T00:00:00Z'), userId: 'u1', layerId: 'l1' }],
        'UTC',
        '2026-01-01',
        '2026-01-03'
      )
    ).toEqual([]);
  });
});

describe('findCoverageGapDays', () => {
  const now = at('2026-01-01T12:00:00Z');
  it('returns nothing when every day is covered', () => {
    expect(
      findCoverageGapDays([{ start: '2025-12-31T00:00:00Z', end: '2026-01-20T00:00:00Z' }], 'UTC', now, 14)
    ).toEqual([]);
  });

  it('names each day with an uncovered stretch', () => {
    expect(
      findCoverageGapDays(
        [
          { start: at('2025-12-31T00:00:00Z'), end: at('2026-01-03T06:00:00Z') },
          { start: at('2026-01-04T00:00:00Z'), end: at('2026-01-20T00:00:00Z') },
        ],
        'UTC',
        now,
        14
      )
    ).toEqual(['2026-01-03']);
  });
});

describe('page bucket time handling', () => {
  it('treats 22:00-07:00 as night', () => {
    expect([21, 22, 23, 0, 6, 7].map(isNightHour)).toEqual([false, true, true, true, true, false]);
  });

  it('reads the local hour across a DST change', () => {
    // New York leaves DST on 2026-11-01: 05:30Z is 01:30 EDT, 06:30Z is 01:30 EST, 07:30Z is 02:30 EST.
    expect(localHour(at('2026-11-01T05:30:00Z'), 'America/New_York')).toBe(1);
    expect(localHour(at('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(1);
    expect(localHour(at('2026-11-01T07:30:00Z'), 'America/New_York')).toBe(2);
    expect(localHour(at('2026-11-01T07:30:00Z'), 'Not/AZone')).toBe(7);
  });

  it('rebuilds the hour a bucket stands for, including on DST days', () => {
    // 2026-03-08 is spring-forward in New York: 03:00 local is 07:00Z.
    expect(bucketInstant({ day: '2026-03-08', hour: 3 }, 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:00:00.000Z'
    );
    // 23:00 local on the evening before belongs to the same UTC day (04:00Z).
    expect(bucketInstant({ day: '2026-03-08', hour: 23 }, 'America/New_York').toISOString()).toBe(
      '2026-03-08T04:00:00.000Z'
    );
    // Fall-back: the repeated 01:00 resolves to its first occurrence.
    expect(bucketInstant({ day: '2026-11-01', hour: 1 }, 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:00:00.000Z'
    );
    // Half-hour zone: 10:00-11:00 IST is 04:30Z-05:30Z; the UTC hour that starts inside it is 05:00Z.
    expect(bucketInstant({ day: '2026-01-10', hour: 10 }, 'Asia/Kolkata').toISOString()).toBe(
      '2026-01-10T05:00:00.000Z'
    );
  });
});

const from = at('2026-01-01T00:00:00Z');
const to = at('2026-01-29T00:00:00Z');
const bucket = (userId: string, day: string, hour: number, pages = 1, weekend = false): PageBucket => ({
  userId,
  day,
  hour,
  weekend,
  pages,
});

describe('computeLoad', () => {
  it('computes each number for one person', () => {
    const load = computeLoad({
      buckets: [
        bucket('u1', '2026-01-02', 23, 2),
        bucket('u1', '2026-01-03', 3, 1, true),
        bucket('u1', '2026-01-10', 14, 4, true),
      ],
      users: [{ userId: 'u1', timeZone: 'UTC' }],
      onCallSeconds: new Map([['u1', 2 * WEEK]]),
      from,
      to,
    });
    const [person] = load.people;
    expect(person).toMatchObject({
      pages: 7,
      nightPages: 3,
      weekendPages: 5,
      interruptedHours: 3,
      nightsPaged: 2,
      weeksWithNightPages: 1,
      onCallHours: 336,
      pagesPerOnCallWeek: 3.5,
    });
    // Last page hour ends 2026-01-10T15:00Z; the window ends 2026-01-29T00:00Z.
    expect(person.longestQuietGapHours).toBe(18 * 24 + 9);
    expect(person.daily).toHaveLength(28);
    expect(person.daily[1]).toEqual({ day: '2026-01-02', pages: 2 });
    expect(load.fairnessIndex).toBeNull();
  });

  it('reports the whole window as quiet for someone never paged', () => {
    const load = computeLoad({
      buckets: [],
      users: [{ userId: 'u1' }],
      onCallSeconds: new Map(),
      from,
      to,
    });
    expect(load.people[0]).toMatchObject({
      pages: 0,
      longestQuietGapHours: 28 * 24,
      pagesPerOnCallWeek: null,
      vsRotationMean: null,
    });
    expect(load.meanPagesPerOnCallWeek).toBeNull();
  });

  it('compares people on pages per on-call week and scores fairness', () => {
    const even = computeLoad({
      buckets: [bucket('a', '2026-01-02', 10, 4), bucket('b', '2026-01-09', 10, 2)],
      users: [{ userId: 'a' }, { userId: 'b' }],
      // b was on call half as long and got half the pages: that is fair.
      onCallSeconds: new Map([
        ['a', 2 * WEEK],
        ['b', WEEK],
      ]),
      from,
      to,
    });
    expect(even.fairnessIndex).toBe(1);
    expect(even.people.map(person => person.vsRotationMean)).toEqual([1, 1]);

    const skewed = computeLoad({
      buckets: [bucket('a', '2026-01-02', 10, 12)],
      users: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }],
      onCallSeconds: new Map([
        ['a', WEEK],
        ['b', WEEK],
        ['c', WEEK],
      ]),
      from,
      to,
    });
    expect(skewed.fairnessIndex).toBe(0.33);
    expect(skewed.meanPagesPerOnCallWeek).toBe(4);
    expect(skewed.people[0].vsRotationMean).toBe(3);
  });
});

describe('on-call insights', () => {
  const names = new Map(Object.entries({ a: 'Asha', b: 'Bo', c: 'Cy' }));
  const equalSeconds = new Map([
    ['a', WEEK],
    ['b', WEEK],
    ['c', WEEK],
  ]);
  const users = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }];

  it('flags the person above 1.5x the rotation mean, and nobody in a fair rotation', () => {
    const unfair = computeLoad({
      buckets: [bucket('a', '2026-01-02', 10, 12), bucket('b', '2026-01-09', 10, 3)],
      users,
      onCallSeconds: equalSeconds,
      from,
      to,
    });
    const items = unfairRotationInsights(unfair, names, { rotationHref: '/schedules/s1?tab=rotation' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'a',
      kind: ONCALL_INSIGHT_KINDS.unfairRotation,
      severity: 'WARNING',
      subjectUserId: 'a',
      draftHref: '/schedules/s1?tab=rotation',
    });
    expect(items[0].title).toContain('Asha');
    expect(items[0].evidence.facts).toContainEqual({ label: 'Rotation mean', value: '5' });

    const fair = computeLoad({
      buckets: users.map(user => bucket(user.userId, '2026-01-02', 10, 10)),
      users,
      onCallSeconds: equalSeconds,
      from,
      to,
    });
    expect(unfairRotationInsights(fair, names)).toEqual([]);
  });

  it('does not call a rotation unfair on a handful of pages', () => {
    const load = computeLoad({
      buckets: [bucket('a', '2026-01-02', 10, 3)],
      users,
      onCallSeconds: equalSeconds,
      from,
      to,
    });
    expect(unfairRotationInsights(load, names)).toEqual([]);
  });

  it('flags night pages that recur across weeks, not one bad week', () => {
    const recurring = computeLoad({
      buckets: ['2026-01-02', '2026-01-03', '2026-01-09', '2026-01-10', '2026-01-16', '2026-01-17'].map(
        day => bucket('a', day, 2)
      ),
      users,
      onCallSeconds: equalSeconds,
      from,
      to,
    });
    const items = sustainedNightLoadInsights(recurring, names);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'a',
      kind: ONCALL_INSIGHT_KINDS.sustainedNightLoad,
      severity: 'WARNING',
      subjectUserId: 'a',
    });

    const oneWeek = computeLoad({
      buckets: ['01', '02', '03', '04', '05', '06'].map(day => bucket('a', `2026-01-${day}`, 2)),
      users,
      onCallSeconds: equalSeconds,
      from,
      to,
    });
    expect(sustainedNightLoadInsights(oneWeek, names)).toEqual([]);
  });

  it('raises a coverage gap, critical when it starts today or tomorrow', () => {
    const base = { todayKey: '2026-01-01', tomorrowKey: '2026-01-02', overridesHref: '/schedules/s1?tab=overrides' };
    expect(coverageGapInsights({ ...base, gapDays: [] })).toEqual([]);
    const [later] = coverageGapInsights({ ...base, gapDays: ['2026-01-05', '2026-01-06'] });
    expect(later).toMatchObject({
      key: 'next-14d',
      kind: ONCALL_INSIGHT_KINDS.coverageGap,
      severity: 'WARNING',
      draftHref: '/schedules/s1?tab=overrides',
    });
    expect(later.subjectUserId).toBeUndefined();
    expect(coverageGapInsights({ ...base, gapDays: ['2026-01-02'] })[0].severity).toBe('CRITICAL');
  });

  it('finds hours where one person is both primary and backup', () => {
    const window = { from: at('2026-01-01T00:00:00Z'), to: at('2026-01-15T00:00:00Z'), names };
    const items = samePersonPrimarySecondaryInsights({
      ...window,
      primary: [
        { userId: 'a', start: at('2026-01-01T00:00:00Z'), end: at('2026-01-02T00:00:00Z') },
        { userId: 'b', start: at('2026-01-02T00:00:00Z'), end: at('2026-01-03T00:00:00Z') },
      ],
      secondary: [
        { userId: 'a', start: at('2026-01-01T12:00:00Z'), end: at('2026-01-02T12:00:00Z') },
        { userId: 'c', start: at('2026-01-02T12:00:00Z'), end: at('2026-01-03T00:00:00Z') },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'a', kind: ONCALL_INSIGHT_KINDS.samePersonPrimarySecondary });
    expect(items[0].evidence.facts[0].value).toBe('12');
    expect(
      samePersonPrimarySecondaryInsights({
        ...window,
        primary: [{ userId: 'a', start: at('2026-01-01T00:00:00Z'), end: at('2026-01-02T00:00:00Z') }],
        secondary: [{ userId: 'b', start: at('2026-01-01T00:00:00Z'), end: at('2026-01-02T00:00:00Z') }],
      })
    ).toEqual([]);
  });

  it('warns the incoming person only when a service carries a risk signal', () => {
    const shift = { userId: 'a', start: at('2026-01-05T09:00:00Z'), end: at('2026-01-12T09:00:00Z') };
    expect(upcomingShiftHeavyInsights({ shift, signals: [] })).toEqual([]);
    const [item] = upcomingShiftHeavyInsights({
      shift,
      signals: [
        { kind: 'RISKY_CHANGE', serviceId: 's1', serviceName: 'Checkout' },
        { kind: 'SLO_BURNING', serviceId: 's1', serviceName: 'Checkout' },
      ],
    });
    expect(item).toMatchObject({
      key: 'a:2026-01-05T09:00:00.000Z',
      kind: ONCALL_INSIGHT_KINDS.upcomingShiftHeavy,
      severity: 'WARNING',
      subjectUserId: 'a',
    });
    expect(item.evidence.examples).toEqual([{ label: 'Checkout', href: '/services/s1' }]);
  });

  it('keeps every title within the insight store limit even for long names', () => {
    const longNames = new Map(Object.entries({ a: 'N'.repeat(300), b: 'Bo', c: 'Cy' }));
    const load = computeLoad({
      buckets: [
        bucket('a', '2026-01-02', 2, 12),
        ...['2026-01-03', '2026-01-09', '2026-01-10', '2026-01-16', '2026-01-17'].map(day =>
          bucket('a', day, 2)
        ),
      ],
      users,
      onCallSeconds: equalSeconds,
      from,
      to,
    });
    const items = [
      ...unfairRotationInsights(load, longNames),
      ...sustainedNightLoadInsights(load, longNames),
    ];
    expect(items.length).toBe(2);
    for (const item of items) expect(item.title.length).toBeLessThanOrEqual(140);
  });
});
