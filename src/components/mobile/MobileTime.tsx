'use client';

import { useMemo } from 'react';
import { formatDateTime } from '@/lib/timezone';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDayLabel, formatRelativeShort, formatShiftEnd } from '@/lib/mobile-time';

type MobileTimeFormat =
  | 'relative'
  | 'relative-short'
  | 'date'
  | 'time'
  | 'short'
  | 'datetime'
  | 'shift-end'
  | 'day-label';

type MobileTimeProps = {
  value: Date | string | number;
  format?: MobileTimeFormat;
  className?: string;
  fallback?: string;
};

export default function MobileTime({
  value,
  format = 'datetime',
  className,
  fallback = '--',
}: MobileTimeProps) {
  const { userTimeZone } = useTimezone();

  const output = useMemo(() => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;

    switch (format) {
      case 'relative':
        return formatDateTime(date, userTimeZone, { format: 'relative' });
      case 'relative-short':
        return formatRelativeShort(date, userTimeZone);
      case 'date':
        return formatDateTime(date, userTimeZone, { format: 'date' });
      case 'time':
        return formatDateTime(date, userTimeZone, { format: 'time' });
      case 'short':
        return formatDateTime(date, userTimeZone, { format: 'short' });
      case 'shift-end':
        return formatShiftEnd(date, userTimeZone);
      case 'day-label':
        return formatDayLabel(date, userTimeZone);
      case 'datetime':
      default:
        return formatDateTime(date, userTimeZone, { format: 'datetime' });
    }
  }, [value, format, userTimeZone, fallback]);

  const suppressHydrationWarning =
    format === 'relative' || format === 'relative-short' || format === 'day-label';

  return (
    <span className={className} suppressHydrationWarning={suppressHydrationWarning}>
      {output}
    </span>
  );
}
