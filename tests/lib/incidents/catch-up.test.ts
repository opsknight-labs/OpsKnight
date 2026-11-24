import { describe, expect, it } from 'vitest';
import {
  catchUpKind,
  countsLine,
  summarizeSince,
  type CatchUpItem,
} from '@/lib/incidents/catch-up';

const item = (minute: number, kind: CatchUpItem['kind'], text: string = kind): CatchUpItem => ({
  at: new Date(Date.UTC(2026, 10, 23, 10, minute)).toISOString(),
  kind,
  text,
});

describe('catch me up', () => {
  it('counts what changed since the last visit, newest status and escalation in words', () => {
    const items = [
      item(1, 'note'),
      item(5, 'alert'),
      item(6, 'alert'),
      item(7, 'escalation', 'Escalated to step 2'),
      item(8, 'escalation', 'Escalated to step 3'),
      item(9, 'status', 'Incident acknowledged by Ivy'),
      item(10, 'note'),
    ];
    const summary = summarizeSince(items, new Date(Date.UTC(2026, 10, 23, 10, 4)).toISOString());
    expect(summary.total).toBe(6);
    expect(summary.highlights).toEqual(['Incident acknowledged by Ivy', 'Escalated to step 3']);
    expect(countsLine(summary.counts)).toBe('2 alerts · 1 note · 2 escalations · 1 status change');
  });

  it('is empty when nothing happened since', () => {
    expect(
      summarizeSince([item(1, 'note')], new Date(Date.UTC(2026, 10, 23, 11)).toISOString()).total
    ).toBe(0);
  });

  it('classifies events by type, then by message', () => {
    expect(catchUpKind('NOTE', '')).toBe('note');
    expect(catchUpKind('ESCALATED', '')).toBe('escalation');
    expect(catchUpKind('LEGACY_OTHER', 'Escalated to TEAM: Platform (Level 3)')).toBe('escalation');
    expect(catchUpKind('ACKNOWLEDGED', '')).toBe('status');
    expect(catchUpKind('ROLE_ASSIGNED', '')).toBe('assignment');
    expect(catchUpKind('LEGACY_OTHER', 'Something else')).toBe('other');
  });
});
