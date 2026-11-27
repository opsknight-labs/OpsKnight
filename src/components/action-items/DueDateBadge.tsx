import { memo } from 'react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/timezone';
import { actionItemOverdueBefore } from '@/lib/action-item-due-dates';
import { AlertTriangle, Clock, Calendar, CheckCircle2 } from 'lucide-react';

export type DueDateBadgeProps = {
  dueDate: string | Date | null | undefined;
  completedAt?: string | Date | null | undefined;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  userTimeZone: string;
  className?: string;
};

export type DueDateStatus = 'completed' | 'overdue' | 'due-soon' | 'on-track' | 'none';

export function getDueDateStatus(
  dueDate: string | Date | null | undefined,
  status: string,
  now: Date = new Date()
): { type: DueDateStatus; daysDiff?: number } {
  if (status === 'COMPLETED') {
    return { type: 'completed' };
  }

  if (!dueDate) {
    return { type: 'none' };
  }

  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) {
    return { type: 'none' };
  }

  // A due date is a calendar date stored at 00:00Z. Compare it with today's UTC day, the same rule
  // as the board count, the API filter and the reminders (actionItemOverdueBefore), so the badge
  // never disagrees with them whichever side of UTC the viewer is on.
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const today = actionItemOverdueBefore(now).getTime();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysDiff = Math.round((dueDay - today) / msPerDay);

  if (daysDiff < 0) {
    return { type: 'overdue', daysDiff: Math.abs(daysDiff) };
  }

  if (daysDiff <= 3) {
    return { type: 'due-soon', daysDiff };
  }

  return { type: 'on-track', daysDiff };
}

function DueDateBadge({
  dueDate,
  completedAt,
  status,
  userTimeZone,
  className,
}: DueDateBadgeProps) {
  const result = getDueDateStatus(dueDate, status);

  if (result.type === 'completed') {
    const formatted = completedAt
      ? formatDateTime(completedAt, userTimeZone, { format: 'date' })
      : dueDate
        ? formatDateTime(dueDate, 'UTC', { format: 'date' })
        : null;

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
          className
        )}
      >
        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        <span>Completed {formatted ? `(${formatted})` : ''}</span>
      </span>
    );
  }

  if (result.type === 'none') {
    return null;
  }

  const formattedDate = dueDate ? formatDateTime(dueDate, 'UTC', { format: 'date' }) : '';

  if (result.type === 'overdue') {
    const days = result.daysDiff ?? 1;
    const label = days === 0 ? 'Overdue today' : `Overdue by ${days}d`;

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 shadow-xs animate-pulse dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
          className
        )}
        title={`Due on ${formattedDate}`}
      >
        <AlertTriangle className="h-3 w-3 text-rose-600 dark:text-rose-400" />
        <span>{label}</span>
      </span>
    );
  }

  if (result.type === 'due-soon') {
    const days = result.daysDiff ?? 0;
    const label = days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days}d`;

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
          className
        )}
        title={`Due on ${formattedDate}`}
      >
        <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-ink-100 text-ink-700 border border-ink-200/80',
        className
      )}
    >
      <Calendar className="h-3 w-3 text-ink-500" />
      <span>Due {formattedDate}</span>
    </span>
  );
}

export default memo(DueDateBadge);
