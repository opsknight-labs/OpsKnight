/**
 * Centralized timezone utilities for consistent date/time formatting
 * across all components in the incident management system
 */
import { logger } from '@/lib/logger';
import { getTimeZones } from '@vvo/tzdb';

type TimeZoneOption = {
  value: string;
  label: string;
  description?: string;
  countryName?: string;
  mainCities?: string[];
  keywords?: string[];
  offsetMinutes: number;
  offsetLabel: string;
};

/**
 * Get user's timezone preference, fallback to UTC
 */
export function getUserTimeZone(user?: { timeZone?: string | null }): string {
  return user?.timeZone || 'UTC';
}

/**
 * Get browser's timezone (for public pages)
 */
export function getBrowserTimeZone(): string {
  if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return 'UTC';
}

/**
 * Format date/time in specified timezone
 * SSR-safe: Returns consistent format for server and client
 */
export function formatDateTime(
  date: Date | string,
  timeZone: string,
  options?: {
    format?: 'date' | 'time' | 'datetime' | 'relative' | 'short';
    includeTimeZone?: boolean;
    hour12?: boolean;
  }
): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  if (!d || isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  const { format = 'datetime', includeTimeZone = false, hour12 = true } = options || {};

  try {
    switch (format) {
      case 'date':
        return new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone,
        }).format(d);

      case 'time':
        return new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12,
          timeZone,
        }).format(d);

      case 'short':
        return new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12,
          timeZone,
        }).format(d);

      case 'datetime':
      default:
        const formatted = new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12,
          timeZone,
        }).format(d);

        if (includeTimeZone) {
          const tzName = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'short',
          }).format(d);
          return `${formatted} ${tzName}`;
        }

        return formatted;

      case 'relative':
        return formatRelativeTime(d, timeZone);
    }
  } catch (_error) {
    // Fallback to UTC if timezone is invalid
    logger.warn('Invalid timezone, falling back to UTC', { timeZone });
    return formatDateTime(d, 'UTC', options);
  }
}

/**
 * Format relative time (e.g., "2 hours ago", "in 3 days")
 */
function formatRelativeTime(date: Date, timeZone: string): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (Math.abs(diffSeconds) < 60) {
    return diffSeconds < 0 ? 'just now' : 'in a few seconds';
  }

  if (Math.abs(diffMinutes) < 60) {
    return diffMinutes < 0
      ? `${Math.abs(diffMinutes)} minute${Math.abs(diffMinutes) !== 1 ? 's' : ''} ago`
      : `in ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
  }

  if (Math.abs(diffHours) < 24) {
    return diffHours < 0
      ? `${Math.abs(diffHours)} hour${Math.abs(diffHours) !== 1 ? 's' : ''} ago`
      : `in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  }

  if (Math.abs(diffDays) < 7) {
    return diffDays < 0
      ? `${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? 's' : ''} ago`
      : `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  }

  // For longer periods, show actual date
  return formatDateTime(date, timeZone, { format: 'datetime' });
}

/**
 * Get timezone label (e.g., "America/New_York" -> "Eastern Time (ET)")
 */
export function getTimeZoneLabel(timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'long',
    });
    const parts = formatter.formatToParts(new Date());
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value || timeZone;

    // Add abbreviation
    const shortFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    });
    const shortParts = shortFormatter.formatToParts(new Date());
    const tzAbbr = shortParts.find(p => p.type === 'timeZoneName')?.value || '';

    return tzAbbr ? `${tzName} (${tzAbbr})` : tzName;
  } catch {
    return timeZone;
  }
}

/**
 * Get all supported timezones with labels
 */
export function getAllTimeZones(): Array<TimeZoneOption> {
  try {
    const options = getTimeZones().map(tz => {
      const offsetMinutes = tz.currentTimeOffsetInMinutes ?? tz.rawOffsetInMinutes ?? 0;
      const offsetLabel = formatOffset(offsetMinutes);
      const primaryCity = tz.mainCities?.[0] || tz.group?.[0]?.split('/')?.[1]?.replace('_', ' ');
      const fallbackCity = tz.name.split('/').at(-1)?.replace('_', ' ');
      const city = primaryCity || fallbackCity || tz.alternativeName || tz.name;
      const label = `${offsetLabel} — ${city}${tz.countryName ? `, ${tz.countryName}` : ''}`;
      const descriptionParts = [tz.name];
      if (tz.alternativeName) descriptionParts.push(tz.alternativeName);
      const description = descriptionParts.join(' • ');

      const keywords = [
        tz.name,
        tz.countryName,
        tz.continentName,
        tz.alternativeName,
        offsetLabel,
        ...(tz.mainCities || []),
        ...(tz.group || []),
      ].filter(Boolean) as string[];

      return {
        value: tz.name,
        label,
        description,
        countryName: tz.countryName,
        mainCities: tz.mainCities,
        keywords,
        offsetMinutes,
        offsetLabel,
      } satisfies TimeZoneOption;
    });

    return options.sort((a, b) =>
      a.offsetMinutes === b.offsetMinutes
        ? a.label.localeCompare(b.label)
        : a.offsetMinutes - b.offsetMinutes
    );
  } catch {
    // Fallback if tzdb or Intl APIs are unavailable
  }

  // Minimal fallback list
  return [
    {
      value: 'UTC',
      label: 'UTC (Coordinated Universal Time)',
      offsetMinutes: 0,
      offsetLabel: 'UTC',
    },
    {
      value: 'America/New_York',
      label: 'UTC-05:00 — New York, United States',
      offsetMinutes: -300,
      offsetLabel: 'UTC-05:00',
    },
    {
      value: 'Europe/London',
      label: 'UTC+00:00 — London, United Kingdom',
      offsetMinutes: 0,
      offsetLabel: 'UTC+00:00',
    },
    {
      value: 'Asia/Kolkata',
      label: 'UTC+05:30 — Kolkata, India',
      offsetMinutes: 330,
      offsetLabel: 'UTC+05:30',
    },
  ];
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60)
    .toString()
    .padStart(2, '0');
  const mins = (abs % 60).toString().padStart(2, '0');
  return `UTC${sign}${hours}:${mins}`;
}

/**
 * Validate timezone string
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format date for input fields (datetime-local format)
 * Converts UTC date to local timezone for display in input
 */
export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // hourCycle h23 keeps midnight as hour 00. `hour12: false` alone is not
      // enough: on Node 20's ICU, en-US resolves to the h24 cycle and formats
      // midnight as hour "24", which rolls Date.UTC below into the next day and
      // yields a 24h offset error. Node 22 defaults to h23, so this diverged by
      // runtime — see the %24 guard for the same reason.
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        partMap[part.type] = part.value;
      }
    }
    const asUtc = Date.UTC(
      Number(partMap.year),
      Number(partMap.month) - 1,
      Number(partMap.day),
      // Defensive: any ICU build that still reports "24" for midnight
      Number(partMap.hour) % 24,
      Number(partMap.minute),
      Number(partMap.second),
      date.getUTCMilliseconds()
    );
    return asUtc - date.getTime();
  } catch {
    return 0;
  }
}

/**
 * Parse a datetime-local value as a date in the provided timezone.
 */
export function parseDateTimeInTimeZone(value: string, timeZone: string): Date | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if ([year, month, day, hour, minute].some(Number.isNaN)) {
    return null;
  }

  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const guessOffsetMs = getTimeZoneOffsetMs(new Date(utcMillis), timeZone);
  let date = new Date(utcMillis - guessOffsetMs);
  const actualOffsetMs = getTimeZoneOffsetMs(date, timeZone);
  if (actualOffsetMs !== guessOffsetMs) {
    date = new Date(utcMillis - actualOffsetMs);
  }
  return date;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if ([year, month, day].some(Number.isNaN)) {
    return null;
  }
  return { year, month, day };
}

export function getDatePartsInTimeZone(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value);
  return { year, month, day };
}

export function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
  const { year, month, day } = getDatePartsInTimeZone(date, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    return dateKey;
  }
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

export function startOfDayFromDateKey(dateKey: string, timeZone: string): Date {
  const value = `${dateKey}T00:00`;
  return parseDateTimeInTimeZone(value, timeZone) ?? new Date(`${dateKey}T00:00:00Z`);
}

export function startOfNextDayFromDateKey(dateKey: string, timeZone: string): Date {
  const nextKey = addDaysToDateKey(dateKey, 1);
  return startOfDayFromDateKey(nextKey, timeZone);
}

export function startOfDayInTimeZone(date: Date, timeZone: string): Date {
  const dateKey = formatDateKeyInTimeZone(date, timeZone);
  return startOfDayFromDateKey(dateKey, timeZone);
}

export function startOfNextDayInTimeZone(date: Date, timeZone: string): Date {
  const dateKey = formatDateKeyInTimeZone(date, timeZone);
  return startOfNextDayFromDateKey(dateKey, timeZone);
}

export function formatDateForInput(date: Date | string, timeZone: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  if (!d || isNaN(d.getTime())) {
    return '';
  }

  // Get date components in the specified timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const hour = parts.find(p => p.type === 'hour')?.value || '';
  const minute = parts.find(p => p.type === 'minute')?.value || '';

  return `${year}-${month}-${day}T${hour}:${minute}`;
}
