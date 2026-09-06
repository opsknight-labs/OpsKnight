import { formatDateTime } from '@/lib/timezone';

type DateInput = Date | string | number;

const toDate = (value: DateInput) => {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function formatRelativeShort(value: DateInput, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return '--';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  if (timeZone) {
    return formatDateTime(date, timeZone, { format: 'date' });
  }

  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

export function formatDurationShort(start: DateInput, end: DateInput = new Date()): string {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return '--';

  const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) {
    const mins = diffMins % 60;
    return mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours}h`;
  }
  const hours = diffHours % 24;
  return hours > 0 ? `${diffDays}d ${hours}h` : `${diffDays}d`;
}

export function getDateKeyInTimeZone(date: DateInput, timeZone: string): string {
  const parsed = toDate(date) ?? new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

export function formatDayLabel(date: DateInput, timeZone: string): string {
  const parsed = toDate(date);
  if (!parsed) return '--';

  const now = new Date();
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = getDateKeyInTimeZone(yesterday, timeZone);
  const dateKey = getDateKeyInTimeZone(parsed, timeZone);

  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';

  const yearFormatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' });
  const includeYear = yearFormatter.format(parsed) !== yearFormatter.format(now);

  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined,
  }).format(parsed);
}

export function formatShiftEnd(date: DateInput, timeZone: string): string {
  const parsed = toDate(date);
  if (!parsed) return '--';

  const now = new Date();
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = getDateKeyInTimeZone(tomorrow, timeZone);
  const dateKey = getDateKeyInTimeZone(parsed, timeZone);

  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(parsed);

  if (dateKey === todayKey) return `Today ${timeLabel}`;
  if (dateKey === tomorrowKey) return `Tomorrow ${timeLabel}`;

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsed);

  return `${dateLabel} ${timeLabel}`;
}

export function formatPushTimestamp(date: DateInput, timeZone: string): string {
  const parsed = toDate(date);
  if (!parsed) return '--';

  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(parsed);
}
