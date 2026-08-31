import { memo } from 'react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/timezone';
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

  // Calculate day difference at midnight boundaries
  const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysDiff = Math.round((dueMidnight.getTime() - nowMidnight.getTime()) / msPerDay);

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
        ? formatDateTime(dueDate, userTimeZone, { format: 'date' })
        : null;

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80',
          className
        )}
      >
        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        <span>Completed {formatted ? `(${formatted})` : ''}</span>
      </span>
    );
  }

  if (result.type === 'none') {
    return null;
  }

  const formattedDate = dueDate ? formatDateTime(dueDate, userTimeZone, { format: 'date' }) : '';

  if (result.type === 'overdue') {
    const days = result.daysDiff ?? 1;
    const label = days === 0 ? 'Overdue today' : `Overdue by ${days}d`;

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 shadow-sm animate-pulse',
          className
        )}
        title={`Due on ${formattedDate}`}
      >
        <AlertTriangle className="h-3 w-3 text-rose-600" />
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
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80',
          className
        )}
        title={`Due on ${formattedDate}`}
      >
        <Clock className="h-3 w-3 text-amber-600" />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200/80',
        className
      )}
    >
      <Calendar className="h-3 w-3 text-slate-500" />
      <span>Due {formattedDate}</span>
    </span>
  );
}

export default memo(DueDateBadge);
