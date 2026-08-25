import type { NotificationChannel } from './notifications';

export type QuietHoursPreferences = {
  quietHoursEnabled: boolean;
  quietHoursStartMinutes: number;
  quietHoursEndMinutes: number;
  quietHoursWeekendAllDay: boolean;
  timeZone: string | null;
};

type IncidentUrgency = 'LOW' | 'MEDIUM' | 'HIGH' | string | null | undefined;

const DISRUPTIVE_CHANNELS = new Set<NotificationChannel>(['PUSH', 'SMS', 'WHATSAPP']);
const WEEKEND_DAYS = new Set(['Sat', 'Sun']);

function isValidMinuteOfDay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 24 * 60;
}

function isMinuteInsideWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return false;

  if (start < end) {
    return minute >= start && minute < end;
  }

  // Overnight window, e.g. 18:00 -> 08:00.
  return minute >= start || minute < end;
}

export function isQuietHoursActive(
  preferences: QuietHoursPreferences | null | undefined,
  at: Date = new Date()
): boolean {
  if (!preferences?.quietHoursEnabled) return false;

  const start = preferences.quietHoursStartMinutes;
  const end = preferences.quietHoursEndMinutes;
  if (!isValidMinuteOfDay(start) || !isValidMinuteOfDay(end) || start === end) {
    // Fail open for malformed configuration so notification delivery is never
    // accidentally disabled by invalid persisted values.
    return false;
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: preferences.timeZone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);

    const weekday = parts.find(part => part.type === 'weekday')?.value;
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    const minute = Number(parts.find(part => part.type === 'minute')?.value);

    if (!weekday || !Number.isInteger(hour) || !Number.isInteger(minute)) {
      return false;
    }

    if (preferences.quietHoursWeekendAllDay && WEEKEND_DAYS.has(weekday)) {
      return true;
    }

    return isMinuteInsideWindow(hour * 60 + minute, start, end);
  } catch {
    // Invalid IANA timezone: fail open rather than suppressing a page.
    return false;
  }
}

export function filterChannelsForQuietHours(
  channels: NotificationChannel[],
  urgency: IncidentUrgency,
  preferences: QuietHoursPreferences | null | undefined,
  at: Date = new Date()
): { channels: NotificationChannel[]; blockedChannels: Set<NotificationChannel> } {
  const blockedChannels = new Set<NotificationChannel>();

  // Quiet hours intentionally apply only to LOW urgency. MEDIUM/HIGH incidents
  // continue paging so personal preferences cannot hide operationally urgent work.
  if (urgency !== 'LOW' || !isQuietHoursActive(preferences, at)) {
    return { channels, blockedChannels };
  }

  for (const channel of DISRUPTIVE_CHANNELS) {
    blockedChannels.add(channel);
  }

  return {
    channels: channels.filter(channel => !blockedChannels.has(channel)),
    blockedChannels,
  };
}
