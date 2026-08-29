'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Clock, Users } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
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
  userAvatar?: string | null;
  userGender?: string | null;
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

export default function ScheduleCoveragePreview({ effectiveShifts, timeZone }: Props) {
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

  return (
    <Card className="flex flex-col justify-between overflow-hidden border-border/70 shadow-sm">
      <div>
        {/* Compact Header */}
        <CardHeader className="border-b bg-muted/20 px-4 py-2.5 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <CalendarDays className="h-4 w-4" />
              </div>
              <CardTitle className="text-sm font-semibold">Check future coverage</CardTitle>
            </div>
            <input
              aria-label="Preview coverage date"
              type="date"
              value={dateKey}
              onChange={event => setDateKey(event.target.value)}
              className="h-7 rounded border bg-background px-2 text-[11px] text-foreground font-medium shadow-2xs focus-visible:ring-1 focus-visible:ring-primary"
            />
          </div>
        </CardHeader>

        {/* Compact Shift List */}
        <CardContent className="p-2.5 sm:p-3">
          {assignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
              <Users className="h-6 w-6 mb-1 opacity-40" />
              <p className="text-[11px] font-medium">
                No effective coverage scheduled for this date
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/50 rounded-md border bg-card/60">
              {assignments.map(shift => {
                const isOverride = shift.source === 'override';
                const startTime = formatDateTime(shift.start, timeZone, {
                  format: 'short',
                  hour12: false,
                });
                const endTime = formatDateTime(shift.end, timeZone, {
                  format: 'short',
                  hour12: false,
                });

                return (
                  <div
                    key={`${shift.id}-${shift.start.getTime()}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/20"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <DirectUserAvatar
                        avatarUrl={
                          shift.userAvatar ||
                          getDefaultAvatar(shift.userGender, shift.userId || shift.userName)
                        }
                        name={shift.userName}
                        size="xs"
                        className="h-5 w-5 shrink-0"
                      />
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground truncate block text-xs">
                          {shift.userName}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          <span>
                            {startTime} – {endTime}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant={isOverride ? 'warning' : 'secondary'}
                      size="xs"
                      className="text-[9px] px-1.5 py-0 shrink-0 font-normal"
                    >
                      {isOverride ? 'Override' : shift.layerName || 'Effective'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </div>

      <div className="border-t bg-muted/10 px-3.5 py-1.5 sm:px-4 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>Priority &amp; overrides applied</span>
        <span>Times use {timeZone}</span>
      </div>
    </Card>
  );
}
