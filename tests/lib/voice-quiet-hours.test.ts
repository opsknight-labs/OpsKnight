import { describe, expect, it } from 'vitest';
import { filterChannelsForQuietHours, type QuietHoursPreferences } from '@/lib/quiet-hours';

describe('Voice quiet hours suppression policy', () => {
  const activeQuietHours: QuietHoursPreferences = {
    quietHoursEnabled: true,
    quietHoursStartMinutes: 20 * 60, // 20:00
    quietHoursEndMinutes: 8 * 60, // 08:00
    quietHoursWeekendAllDay: true,
    timeZone: 'UTC',
  };

  // 22:00 UTC is inside the quiet hours window (20:00 - 08:00)
  const duringQuietWindow = new Date('2026-09-23T22:00:00Z');
  // 12:00 UTC on a Wednesday is outside the quiet hours window
  const outsideQuietWindow = new Date('2026-09-23T12:00:00Z');

  it('suppresses VOICE during active quiet hours for LOW urgency incidents', () => {
    const result = filterChannelsForQuietHours(
      ['VOICE', 'EMAIL'],
      'LOW',
      activeQuietHours,
      duringQuietWindow
    );

    expect(result.channels).toEqual(['EMAIL']);
    expect(result.blockedChannels.has('VOICE')).toBe(true);
  });

  it('allows VOICE during active quiet hours for MEDIUM urgency incidents', () => {
    const result = filterChannelsForQuietHours(
      ['VOICE', 'EMAIL'],
      'MEDIUM',
      activeQuietHours,
      duringQuietWindow
    );

    expect(result.channels).toEqual(['VOICE', 'EMAIL']);
    expect(result.blockedChannels.has('VOICE')).toBe(false);
  });

  it('allows VOICE during active quiet hours for HIGH urgency incidents', () => {
    const result = filterChannelsForQuietHours(
      ['VOICE', 'EMAIL'],
      'HIGH',
      activeQuietHours,
      duringQuietWindow
    );

    expect(result.channels).toEqual(['VOICE', 'EMAIL']);
    expect(result.blockedChannels.has('VOICE')).toBe(false);
  });

  it('allows VOICE outside quiet hours window for LOW urgency incidents', () => {
    const result = filterChannelsForQuietHours(
      ['VOICE', 'EMAIL'],
      'LOW',
      activeQuietHours,
      outsideQuietWindow
    );

    expect(result.channels).toEqual(['VOICE', 'EMAIL']);
    expect(result.blockedChannels.has('VOICE')).toBe(false);
  });

  it('allows VOICE when quiet hours are disabled even during the configured window', () => {
    const disabledConfig: QuietHoursPreferences = {
      ...activeQuietHours,
      quietHoursEnabled: false,
    };
    const result = filterChannelsForQuietHours(
      ['VOICE', 'EMAIL'],
      'LOW',
      disabledConfig,
      duringQuietWindow
    );

    expect(result.channels).toEqual(['VOICE', 'EMAIL']);
    expect(result.blockedChannels.has('VOICE')).toBe(false);
  });
});
