'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ShieldCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  formatDateTime,
  formatDateForInput,
  startOfDayInTimeZone,
  startOfNextDayInTimeZone,
} from '@/lib/timezone';

type Shift = {
  id: string;
  userId?: string;
  userName: string;
  layerName: string;
  start: Date;
  end: Date;
  source?: 'rotation' | 'override';
  isAdditiveOverride?: boolean;
};

type Props = {
  effectiveShifts: Shift[];
  timeZone: string;
  viewerId: string;
  viewerTimeZone: string;
};

export default function ScheduleCoveragePreview({
  effectiveShifts,
  timeZone,
  viewerId,
  viewerTimeZone,
}: Props) {
  const [referenceTime] = useState(() => new Date());
  const [dateKey, setDateKey] = useState(() =>
    formatDateForInput(new Date(), timeZone).slice(0, 10)
  );
  const selectedDate = useMemo(() => new Date(`${dateKey}T12:00:00Z`), [dateKey]);
  const range = useMemo(() => {
    const start = startOfDayInTimeZone(selectedDate, timeZone);
    return { start, end: startOfNextDayInTimeZone(selectedDate, timeZone) };
  }, [selectedDate, timeZone]);
  const assignments = useMemo(
    () =>
      effectiveShifts
        .filter(shift => shift.start < range.end && shift.end > range.start)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [effectiveShifts, range]
  );
  const myNextShift = useMemo(
    () =>
      effectiveShifts
        .filter(shift => shift.userId === viewerId && shift.end.getTime() > referenceTime.getTime())
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null,
    [effectiveShifts, referenceTime, viewerId]
  );

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Check future coverage</h3>
            <p className="text-xs text-muted-foreground">
              See the effective escalation owner before the handoff.
            </p>
          </div>
        </div>
        <input
          aria-label="Preview coverage date"
          type="date"
          value={dateKey}
          onChange={event => setDateKey(event.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        />
      </div>
      <div className="mt-4 rounded-lg border bg-muted/20">
        {assignments.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-amber-700 dark:text-amber-300">
            <Users className="h-4 w-4" /> No effective coverage is scheduled for this date.
          </div>
        ) : (
          <div className="divide-y">
            {assignments.map(assignment => (
              <div
                key={assignment.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{assignment.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(assignment.start, timeZone, { format: 'time', hour12: false })}{' '}
                    – {formatDateTime(assignment.end, timeZone, { format: 'time', hour12: false })}
                  </p>
                </div>
                <Badge
                  variant={assignment.isAdditiveOverride ? 'success' : 'info'}
                  size="xs"
                  className="shrink-0"
                >
                  {assignment.isAdditiveOverride
                    ? 'Also on call'
                    : assignment.source === 'override'
                      ? 'Override'
                      : 'Effective'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Priority and overrides are already
        applied. Times use {timeZone}.
      </p>
      {myNextShift && (
        <div className="mt-3 border-t pt-3 text-xs">
          <p className="font-medium">Your next on-call</p>
          <p className="mt-0.5 text-muted-foreground">
            {formatDateTime(myNextShift.start, viewerTimeZone, { format: 'short' })} –{' '}
            {formatDateTime(myNextShift.end, viewerTimeZone, { format: 'short' })}
            {viewerTimeZone !== timeZone ? ` · shown in ${viewerTimeZone}` : ''}
          </p>
        </div>
      )}
    </section>
  );
}
