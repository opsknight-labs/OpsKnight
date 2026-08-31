'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateQuietHoursPreferences } from '@/app/(app)/settings/quiet-hours-actions';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Clock3, Info, Moon, ShieldCheck, Sun, Calendar, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type State = {
  error?: string | null;
  success?: boolean;
};

type Props = {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
  weekendAllDay: boolean;
  timeZone: string;
};

const DAYS_OF_WEEK = [
  { id: 'mon', label: 'Mon', full: 'Monday', isWeekend: false },
  { id: 'tue', label: 'Tue', full: 'Tuesday', isWeekend: false },
  { id: 'wed', label: 'Wed', full: 'Wednesday', isWeekend: false },
  { id: 'thu', label: 'Thu', full: 'Thursday', isWeekend: false },
  { id: 'fri', label: 'Fri', full: 'Friday', isWeekend: false },
  { id: 'sat', label: 'Sat', full: 'Saturday', isWeekend: true },
  { id: 'sun', label: 'Sun', full: 'Sunday', isWeekend: true },
];

function minutesToTime(minutes: number): string {
  const safeMinutes = Number.isInteger(minutes) && minutes >= 0 && minutes < 1440 ? minutes : 0;
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function timeToMinutes(timeStr: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export default function QuietHoursForm({
  enabled,
  startMinutes,
  endMinutes,
  weekendAllDay,
  timeZone,
}: Props) {
  const [state, formAction, isPending] = useActionState<State, FormData>(
    updateQuietHoursPreferences,
    { error: null, success: false }
  );
  const [enabledChecked, setEnabledChecked] = useState(enabled);
  const [weekendChecked, setWeekendChecked] = useState(weekendAllDay);
  const [startTime, setStartTime] = useState(minutesToTime(startMinutes));
  const [endTime, setEndTime] = useState(minutesToTime(endMinutes));
  const [activeDays, setActiveDays] = useState<string[]>([
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sun',
  ]);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(() => router.refresh(), 500);
      return () => clearTimeout(timer);
    }
  }, [state?.success, router]);

  const toggleDay = (dayId: string) => {
    setActiveDays(prev =>
      prev.includes(dayId) ? prev.filter(d => d !== dayId) : [...prev, dayId]
    );
  };

  const setPreset = (preset: 'all' | 'weekdays' | 'weekends') => {
    if (preset === 'all') {
      setActiveDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    } else if (preset === 'weekdays') {
      setActiveDays(['mon', 'tue', 'wed', 'thu', 'fri']);
    } else if (preset === 'weekends') {
      setActiveDays(['sat', 'sun']);
    }
  };

  // Calculate percentage coverage for 24-hour visual bar
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const isOvernight = startMin > endMin;

  const timelineSegments = useMemo(() => {
    if (!enabledChecked) return [];
    if (!isOvernight) {
      // Single daytime window
      const left = (startMin / 1440) * 100;
      const width = ((endMin - startMin) / 1440) * 100;
      return [{ left: `${left}%`, width: `${width}%` }];
    }
    // Overnight window (e.g. 18:00 to 08:00): two segments
    const left1 = (startMin / 1440) * 100;
    const width1 = ((1440 - startMin) / 1440) * 100;
    const left2 = 0;
    const width2 = (endMin / 1440) * 100;
    return [
      { left: `${left1}%`, width: `${width1}%` },
      { left: `${left2}%`, width: `${width2}%` },
    ];
  }, [enabledChecked, startMin, endMin, isOvernight]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="quietHoursEnabled" value={enabledChecked ? 'on' : 'off'} />
      <input type="hidden" name="quietHoursWeekendAllDay" value={weekendChecked ? 'on' : 'off'} />
      <input type="hidden" name="quietHoursStart" value={startTime} />
      <input type="hidden" name="quietHoursEnd" value={endTime} />

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-card shadow-xs">
        {/* Header Toggle */}
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Moon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="quiet-hours-switch" className="text-base font-semibold">
                  Quiet Hours
                </Label>
                <Badge
                  variant={enabledChecked ? 'default' : 'secondary'}
                  className="text-[10px] h-4"
                >
                  {enabledChecked ? 'Active' : 'Disabled'}
                </Badge>
              </div>
              <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
                Pause disruptive LOW-urgency push, SMS, and WhatsApp alerts during resting hours.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-auto">
            <Switch
              id="quiet-hours-switch"
              checked={enabledChecked}
              onCheckedChange={setEnabledChecked}
            />
            <Label htmlFor="quiet-hours-switch" className="min-w-14 text-sm font-medium">
              {enabledChecked ? 'Enabled' : 'Disabled'}
            </Label>
          </div>
        </div>

        {/* Informational Guidance */}
        <div className="flex items-start gap-2 border-t border-slate-100 bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            <span className="font-medium text-foreground">Operational Rule:</span> Quiet hours apply
            strictly to <strong>LOW</strong> urgency alerts. <strong>MEDIUM</strong> and{' '}
            <strong>HIGH</strong> urgency alerts will always page your device immediately.
          </p>
        </div>

        {enabledChecked && (
          <div className="space-y-6 border-t border-slate-100 bg-muted/10 p-4 sm:p-5">
            {/* 1. Granular Day-of-Week Pill Selector */}
            <div className="space-y-3 rounded-xl border border-slate-200/80 bg-background p-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Active Quiet Days</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreset('all')}
                    className="px-2 py-0.5 rounded-md hover:bg-slate-100 text-muted-foreground hover:text-foreground font-medium transition-colors"
                  >
                    All Week
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={() => setPreset('weekdays')}
                    className="px-2 py-0.5 rounded-md hover:bg-slate-100 text-muted-foreground hover:text-foreground font-medium transition-colors"
                  >
                    Weekdays
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={() => setPreset('weekends')}
                    className="px-2 py-0.5 rounded-md hover:bg-slate-100 text-muted-foreground hover:text-foreground font-medium transition-colors"
                  >
                    Weekends
                  </button>
                </div>
              </div>

              {/* Day Pills */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2 pt-1">
                {DAYS_OF_WEEK.map(day => {
                  const isSelected = activeDays.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => toggleDay(day.id)}
                      className={cn(
                        'flex flex-col items-center justify-center py-2 px-1 rounded-lg border text-xs transition-all duration-150',
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary font-semibold shadow-xs scale-[1.02]'
                          : 'bg-background text-muted-foreground border-slate-200 hover:bg-slate-50 hover:text-foreground'
                      )}
                    >
                      <span>{day.label}</span>
                      <span className={cn('text-[9px] opacity-80 mt-0.5 hidden sm:inline')}>
                        {day.isWeekend ? 'Weekend' : 'Weekday'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Start & End Time Inputs + Weekend Option */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(16rem,1.35fr)]">
              <div className="space-y-2 rounded-xl border border-slate-200/80 bg-background p-4 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4 text-primary" aria-hidden="true" />
                  <Label htmlFor="quiet-hours-start" className="text-sm font-semibold">
                    Starts At (Mute)
                  </Label>
                </div>
                <Input
                  id="quiet-hours-start"
                  type="time"
                  value={startTime}
                  onChange={event => setStartTime(event.target.value)}
                  className="w-full h-10"
                />
                <span className="text-[11px] text-muted-foreground">
                  Alerts silenced from this hour
                </span>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200/80 bg-background p-4 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  <Label htmlFor="quiet-hours-end" className="text-sm font-semibold">
                    Ends At (Resume)
                  </Label>
                </div>
                <Input
                  id="quiet-hours-end"
                  type="time"
                  value={endTime}
                  onChange={event => setEndTime(event.target.value)}
                  className="w-full h-10"
                />
                <span className="text-[11px] text-muted-foreground">
                  Standard notifications resume
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-background p-4 shadow-2xs">
                <div>
                  <Label htmlFor="quiet-hours-weekend" className="text-sm font-semibold">
                    Quiet all day on weekends
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Silences low-urgency alerts all 48 hours of Sat & Sun.
                  </p>
                </div>
                <Switch
                  id="quiet-hours-weekend"
                  checked={weekendChecked}
                  onCheckedChange={setWeekendChecked}
                />
              </div>
            </div>

            {/* 3. 24-Hour Visual Schedule Timeline Bar */}
            <div className="rounded-xl border border-slate-200/80 bg-background p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-primary" />
                  24-Hour Schedule Timeline
                </span>
                <span className="text-muted-foreground">
                  Timezone: <span className="font-medium text-foreground">{timeZone}</span>
                </span>
              </div>

              {/* Progress track */}
              <div className="relative h-6 bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                {/* Active Muted Ranges */}
                {timelineSegments.map((seg, idx) => (
                  <div
                    key={idx}
                    className="absolute top-0 bottom-0 bg-primary/20 border-r border-l border-primary/40 flex items-center justify-center"
                    style={{ left: seg.left, width: seg.width }}
                  >
                    <span className="text-[10px] font-semibold text-primary select-none flex items-center gap-1">
                      <Moon className="h-2.5 w-2.5" /> Muted
                    </span>
                  </div>
                ))}
              </div>

              {/* Time tick labels */}
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>00:00 (Midnight)</span>
                <span>06:00</span>
                <span>12:00 (Noon)</span>
                <span>18:00</span>
                <span>23:59</span>
              </div>
            </div>

            {/* Guarantee Callout */}
            <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
              <p className="flex items-start gap-2 rounded-lg bg-background/80 p-3 border border-slate-200/60">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  Adjusts automatically based on your timezone:{' '}
                  <span className="font-semibold text-foreground">{timeZone}</span>.
                </span>
              </p>
              <p className="flex items-start gap-2 rounded-lg bg-background/80 p-3 border border-slate-200/60">
                <ShieldCheck
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <span>Critical alerts, P1/P2 incidents, and in-app logs are never muted.</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {(state?.error || state?.success) && (
        <div
          className={cn(
            'p-3 rounded-xl text-sm font-medium border shadow-2xs',
            state?.error
              ? 'bg-destructive/10 text-destructive border-destructive/20'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          )}
        >
          {state?.error ? state.error : 'Quiet-hours preferences saved successfully.'}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          {isPending ? 'Saving...' : 'Save Quiet Hours Preferences'}
        </Button>
      </div>
    </form>
  );
}
