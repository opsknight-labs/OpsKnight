import { describe, expect, it } from 'vitest';
import { filterChannelsForQuietHours, isQuietHoursActive } from '@/lib/quiet-hours';

const basePreferences = {
  quietHoursEnabled: true,
  quietHoursStartMinutes: 18 * 60,
  quietHoursEndMinutes: 8 * 60,
  quietHoursWeekendAllDay: true,
  timeZone: 'UTC',
};

describe('quiet-hours notification policy', () => {
  it('recognizes an overnight quiet-hours window', () => {
    expect(isQuietHoursActive(basePreferences, new Date('2026-08-26T22:00:00.000Z'))).toBe(true);
    expect(isQuietHoursActive(basePreferences, new Date('2026-08-26T10:00:00.000Z'))).toBe(false);
  });

  it('treats weekends as all-day quiet hours when enabled', () => {
    expect(isQuietHoursActive(basePreferences, new Date('2026-08-29T12:00:00.000Z'))).toBe(true);
  });

  it('does not suppress anything when quiet hours are disabled', () => {
    const result = filterChannelsForQuietHours(
      ['PUSH', 'SMS', 'WHATSAPP', 'EMAIL'],
      'LOW',
      { ...basePreferences, quietHoursEnabled: false },
      new Date('2026-08-26T22:00:00.000Z')
    );

    expect(result.channels).toEqual(['PUSH', 'SMS', 'WHATSAPP', 'EMAIL']);
    expect(result.blockedChannels.size).toBe(0);
  });

  it('suppresses disruptive channels for LOW urgency but keeps email', () => {
    const result = filterChannelsForQuietHours(
      ['PUSH', 'SMS', 'WHATSAPP', 'EMAIL'],
      'LOW',
      basePreferences,
      new Date('2026-08-26T22:00:00.000Z')
    );

    expect(result.channels).toEqual(['EMAIL']);
    expect(result.blockedChannels).toEqual(new Set(['PUSH', 'SMS', 'WHATSAPP']));
  });

  it('allows MEDIUM and HIGH urgency to bypass quiet hours', () => {
    const at = new Date('2026-08-26T22:00:00.000Z');

    expect(filterChannelsForQuietHours(['PUSH'], 'MEDIUM', basePreferences, at).channels).toEqual([
      'PUSH',
    ]);
    expect(filterChannelsForQuietHours(['PUSH'], 'HIGH', basePreferences, at).channels).toEqual([
      'PUSH',
    ]);
  });

  it('fails open for an invalid timezone', () => {
    expect(
      isQuietHoursActive(
        { ...basePreferences, timeZone: 'Definitely/Not-A-Timezone' },
        new Date('2026-08-26T22:00:00.000Z')
      )
    ).toBe(false);
  });
});
