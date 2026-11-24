import { describe, expect, it } from 'vitest';
import { describeLocalZone, describeOverrideEffect } from '@/lib/status-pages/override-preview';

const now = new Date('2026-12-01T00:00:00Z');

describe('override preview text', () => {
  it('describes an explicit end in local zone and UTC', () => {
    const text = describeOverrideEffect({
      status: 'MAJOR_OUTAGE',
      until: '2026-12-03T09:00:00.000Z',
      timeZone: 'Asia/Kolkata',
      now,
    });
    expect(text).toContain('until Dec 3, 2026, 14:30 (Asia/Kolkata) / Dec 3, 2026, 09:00 UTC');
    expect(text.endsWith('then automatic.')).toBe(true);
  });
  it('explains the 30 day default and the cleared and past cases', () => {
    expect(
      describeOverrideEffect({ status: 'MAJOR_OUTAGE', until: null, timeZone: 'UTC', now })
    ).toMatch(/^No end time set, so shown as .* until Dec 31, 2026/);
    expect(describeOverrideEffect({ status: null, until: null, timeZone: 'UTC', now })).toContain(
      'automatically'
    );
    expect(
      describeOverrideEffect({
        status: 'MAJOR_OUTAGE',
        until: '2026-11-01T00:00:00Z',
        timeZone: 'UTC',
        now,
      })
    ).toContain('past');
  });
  it('labels the zone with its offset', () => {
    expect(describeLocalZone('Asia/Kolkata', now)).toContain('GMT+5:30');
  });
});
