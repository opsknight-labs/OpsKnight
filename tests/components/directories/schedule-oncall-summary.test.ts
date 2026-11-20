import { describe, expect, it } from 'vitest';
import { summarizeScheduleOnCall } from '@/components/schedules/schedule-oncall-summary';

const user = (id: string) => ({ userId: id, position: 0, user: { name: id.toUpperCase() } });

describe('summarizeScheduleOnCall', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const layer = {
    id: 'l1',
    name: 'Primary',
    start,
    end: null,
    rotationLengthHours: 24,
    priority: 0,
    users: [
      { ...user('ann'), position: 0 },
      { ...user('bob'), position: 1 },
    ],
  };

  it('returns the current responder and the next different one', () => {
    const now = new Date('2026-01-01T06:00:00Z');
    const summary = summarizeScheduleOnCall({ timeZone: 'UTC', layers: [layer] }, [], now);
    expect(summary.onCallNow?.name).toBe('ANN');
    expect(summary.next?.name).toBe('BOB');
    expect(summary.next?.start.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('returns nothing for a schedule without responders', () => {
    const summary = summarizeScheduleOnCall(
      { timeZone: 'UTC', layers: [{ ...layer, users: [] }] },
      [],
      new Date('2026-01-01T06:00:00Z')
    );
    expect(summary).toEqual({ onCallNow: null, next: null });
  });
});
