import { describe, expect, it } from 'vitest';
import {
  buildMaintenanceAgenda,
  describeMatcher,
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
