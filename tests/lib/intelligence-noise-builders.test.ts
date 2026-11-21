import { describe, expect, it } from 'vitest';
import {
  buildMaintenanceAgenda,
  describeMatcher,
  describeRecurrence,
  moveItem,
  presetForRecurrence,
  recurrenceForPreset,
  shiftIntoReplayRange,
  slugifyRuleId,
  upcomingOccurrences,
  validateMatcherDrafts,
  validateOrchestrationRules,
} from '@/lib/intelligence/noise-controls/builders';

const at = (iso: string) => new Date(iso);

describe('recurrence presets', () => {
  it('maps presets to RRULEs anchored on the UTC start day, and back', () => {
    const wednesday = at('2026-11-11T22:00:00Z');
    expect(recurrenceForPreset('none', wednesday)).toBeNull();
    expect(recurrenceForPreset('weekly', wednesday)).toBe('FREQ=WEEKLY;BYDAY=WE');
    expect(recurrenceForPreset('weekends', wednesday)).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    expect(recurrenceForPreset('custom', wednesday, ' FREQ=DAILY;COUNT=3 ')).toBe(
      'FREQ=DAILY;COUNT=3'
    );
    expect(presetForRecurrence('FREQ=WEEKLY;BYDAY=WE', wednesday)).toBe('weekly');
    expect(presetForRecurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', wednesday)).toBe('weekdays');
    expect(presetForRecurrence('FREQ=DAILY;COUNT=3', wednesday)).toBe('custom');
    expect(presetForRecurrence(null, wednesday)).toBe('none');
  });
});

describe('weekday presets in the time zone the start was entered in', () => {
  const startsOfOccurrences = (startsAt: Date, recurrence: string | null, now: Date, count = 6) => {
    const check = upcomingOccurrences(
      startsAt,
      new Date(startsAt.getTime() + 3_600_000),
      recurrence,
      now,
      count
    );
    if (!check.ok) throw new Error(check.error);
    return check.occurrences.map(span => span.startsAt);
  };
  const weekdayIn = (date: Date, timeZone: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);

  it('repeats Mon–Fri on the local weekdays for a start whose UTC date is the day before (IST)', () => {
    // Monday 2026-11-16 02:00 in Kolkata is Sunday 20:30Z.
    const startsAt = at('2026-11-15T20:30:00Z');
    const rule = recurrenceForPreset('weekdays', startsAt, '', 'Asia/Kolkata');
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,SU');
    const days = startsOfOccurrences(startsAt, rule, at('2026-11-15T00:00:00Z'), 10).map(date =>
      weekdayIn(date, 'Asia/Kolkata')
    );
    expect(days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(presetForRecurrence(rule, startsAt, 'Asia/Kolkata')).toBe('weekdays');
    expect(describeRecurrence(rule, startsAt, 'Asia/Kolkata')).toBe('Every weekday');
  });

  it('repeats Sat–Sun on the local weekend for a start whose UTC date is the day after (PT)', () => {
    // Saturday 2026-11-14 18:00 in Los Angeles is Sunday 02:00Z.
    const startsAt = at('2026-11-15T02:00:00Z');
    const rule = recurrenceForPreset('weekends', startsAt, '', 'America/Los_Angeles');
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,SU');
    const days = startsOfOccurrences(startsAt, rule, at('2026-11-14T00:00:00Z'), 4).map(date =>
      weekdayIn(date, 'America/Los_Angeles')
    );
    expect(days).toEqual(['Sat', 'Sun', 'Sat', 'Sun']);
    expect(presetForRecurrence(rule, startsAt, 'America/Los_Angeles')).toBe('weekends');
    expect(describeRecurrence(rule, startsAt, 'America/Los_Angeles')).toBe('Every weekend');
  });

  it('describes the weekly preset by the local start day', () => {
    // Friday 18:00 PT is Saturday 02:00Z: stored as SA, described as FR.
    const startsAt = at('2026-11-14T02:00:00Z');
    const rule = recurrenceForPreset('weekly', startsAt, '', 'America/Los_Angeles');
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(
      startsOfOccurrences(startsAt, rule, at('2026-11-13T00:00:00Z'), 3).map(date =>
        weekdayIn(date, 'America/Los_Angeles')
      )
    ).toEqual(['Fri', 'Fri', 'Fri']);
    expect(describeRecurrence(rule, startsAt, 'America/Los_Angeles')).toBe('Every week (FR)');
    expect(presetForRecurrence(rule, startsAt, 'America/Los_Angeles')).toBe('weekly');
  });

  it('leaves rules unchanged when the local and UTC weekday agree', () => {
    const startsAt = at('2026-11-16T09:00:00Z');
    expect(recurrenceForPreset('weekdays', startsAt, '', 'Asia/Kolkata')).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    );
    expect(recurrenceForPreset('weekends', startsAt, '', 'America/Los_Angeles')).toBe(
      'FREQ=WEEKLY;BYDAY=SA,SU'
    );
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Every weekday');
    expect(describeRecurrence('FREQ=DAILY;COUNT=3')).toBe('FREQ=DAILY;COUNT=3');
  });
});

describe('upcomingOccurrences', () => {
  const now = at('2026-11-09T12:00:00Z');
  it('lists the next occurrences of a recurring window', () => {
    const check = upcomingOccurrences(
      at('2026-11-14T02:00:00Z'),
      at('2026-11-14T04:00:00Z'),
      'FREQ=WEEKLY;BYDAY=SA,SU',
      now,
      4
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.occurrences.map(span => span.startsAt.toISOString())).toEqual([
      '2026-11-14T02:00:00.000Z',
      '2026-11-15T02:00:00.000Z',
      '2026-11-21T02:00:00.000Z',
      '2026-11-22T02:00:00.000Z',
    ]);
  });
  it('explains invalid windows instead of throwing', () => {
    expect(
      upcomingOccurrences(at('2026-11-10T00:00:00Z'), at('2026-11-09T00:00:00Z'), null, now)
    ).toEqual({
      ok: false,
      error: 'The end must be after the start.',
    });
    expect(
      upcomingOccurrences(at('2026-11-10T00:00:00Z'), at('2026-11-20T00:00:00Z'), null, now).ok
    ).toBe(false);
    const bad = upcomingOccurrences(
      at('2026-11-10T00:00:00Z'),
      at('2026-11-10T01:00:00Z'),
      'FREQ=HOURLY',
      now
    );
    expect(bad).toMatchObject({ ok: false });
  });
});

describe('buildMaintenanceAgenda', () => {
  const now = at('2026-11-09T12:00:00Z');
  const base = { enabled: true, endedAt: null, effect: 'SUPPRESS' as const };
  it('expands recurring windows, puts in-progress windows on today, and skips disabled or ended ones', () => {
    const agenda = buildMaintenanceAgenda(
      [
        {
          ...base,
          id: 'w1',
          name: 'Nightly',
          startsAt: at('2026-11-01T01:00:00Z'),
          endsAt: at('2026-11-01T02:00:00Z'),
          recurrence: 'FREQ=DAILY',
        },
        {
          ...base,
          id: 'w2',
          name: 'Now',
          startsAt: at('2026-11-08T23:00:00Z'),
          endsAt: at('2026-11-09T14:00:00Z'),
          recurrence: null,
        },
        {
          ...base,
          enabled: false,
          id: 'w3',
          name: 'Off',
          startsAt: at('2026-11-10T00:00:00Z'),
          endsAt: at('2026-11-10T01:00:00Z'),
          recurrence: null,
        },
        {
          ...base,
          endedAt: at('2026-11-09T00:00:00Z'),
          id: 'w4',
          name: 'Ended',
          startsAt: at('2026-11-10T00:00:00Z'),
          endsAt: at('2026-11-10T01:00:00Z'),
          recurrence: null,
        },
      ],
      now,
      3
    );
    expect(agenda.map(day => day.date)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(agenda[0].entries.map(entry => [entry.windowId, entry.active])).toEqual([['w2', true]]);
    expect(
      agenda.flatMap(day => day.entries).every(entry => !['w3', 'w4'].includes(entry.windowId))
    ).toBe(true);
  });
});

describe('buildMaintenanceAgenda in the viewer time zone', () => {
  const base = { enabled: true, endedAt: null, effect: 'SUPPRESS' as const, recurrence: null };
  it('files an entry under the local day its time is shown on, and today is the local today', () => {
    // 2026-11-10 20:00 PT (Tue) is 2026-11-11 04:00Z.
    const now = at('2026-11-11T04:00:00Z');
    const windows = [
      {
        ...base,
        id: 'tue-evening',
        name: 'Tue 18:00 PT',
        startsAt: at('2026-11-18T02:00:00Z'),
        endsAt: at('2026-11-18T03:00:00Z'),
      },
      {
        ...base,
        id: 'in-progress',
        name: 'Running',
        startsAt: at('2026-11-11T03:00:00Z'),
        endsAt: at('2026-11-11T05:00:00Z'),
      },
    ];
    const agenda = buildMaintenanceAgenda(windows, now, 14, 31, 'America/Los_Angeles');
    expect(agenda.map(day => [day.date, day.entries.map(entry => entry.windowId)])).toEqual([
      ['2026-11-10', ['in-progress']],
      ['2026-11-17', ['tue-evening']],
    ]);
    // UTC stays the default for callers that do not pass a zone.
    expect(buildMaintenanceAgenda(windows, now, 14).map(day => day.date)).toEqual([
      '2026-11-11',
      '2026-11-18',
    ]);
  });
});

describe('shiftIntoReplayRange', () => {
  it('moves a future window back by whole weeks into the last week', () => {
    const now = at('2026-11-09T12:00:00Z');
    const shifted = shiftIntoReplayRange(
      at('2026-11-20T03:00:00Z'),
      at('2026-11-20T05:00:00Z'),
      now
    );
    expect(shifted.shiftedWeeks).toBe(2);
    expect(shifted.startsAt.toISOString()).toBe('2026-11-06T03:00:00.000Z');
    expect(shifted.startsAt.getUTCDay()).toBe(at('2026-11-20T03:00:00Z').getUTCDay());
    expect(
      shiftIntoReplayRange(at('2026-11-05T00:00:00Z'), at('2026-11-05T01:00:00Z'), now).shiftedWeeks
    ).toBe(0);
  });
});

describe('matcher and rule validation', () => {
  it('reports one message per invalid row', () => {
    const result = validateMatcherDrafts([
      { field: 'severity', key: '', op: 'equals', value: 'warning' },
      { field: 'label', key: '', op: 'equals', value: 'prod' },
      { field: 'summary', key: '', op: 'regex', value: '(a+)+' },
    ]);
    expect(result.matchers).toBeNull();
    expect(result.errors[0]).toBeNull();
    expect(result.errors[1]).toMatch(/key/);
    expect(result.errors[2]).toMatch(/quantifier/i);
    expect(
      validateMatcherDrafts([{ field: 'source', key: '', op: 'exists', value: '' }]).matchers
    ).toEqual([{ field: 'source', op: 'exists' }]);
  });

  it('validates orchestration rules and catches duplicate ids', () => {
    const rule = {
      id: 'drop-test',
      name: 'Drop test',
      enabled: true,
      conditions: [{ field: 'label', key: 'env', op: 'equals', value: 'test' }],
      actions: [{ type: 'DROP' }],
    };
    expect(validateOrchestrationRules([rule]).rules).toHaveLength(1);
    const duplicate = validateOrchestrationRules([rule, rule]);
    expect(duplicate.rules).toBeNull();
    expect(duplicate.errors.get(1)).toMatch(/Duplicate/);
    expect(validateOrchestrationRules([{ ...rule, actions: [] }]).errors.get(0)).toMatch(/actions/);
  });

  it('slugifies unique ids, moves items and describes matchers', () => {
    expect(slugifyRuleId('Drop Test alerts!', new Set())).toBe('drop-test-alerts');
    expect(slugifyRuleId('Drop', new Set(['drop']))).toBe('drop-2');
    expect(slugifyRuleId('***', new Set())).toBe('rule');
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(describeMatcher({ field: 'label', key: 'env', op: 'equals', value: 'test' })).toBe(
      'label env equals "test"'
    );
  });
});
