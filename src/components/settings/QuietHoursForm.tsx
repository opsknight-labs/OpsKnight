'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateQuietHoursPreferences } from '@/app/(app)/settings/quiet-hours-actions';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Clock3, Info, Moon, ShieldCheck } from 'lucide-react';

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

function minutesToTime(minutes: number): string {
  const safeMinutes = Number.isInteger(minutes) && minutes >= 0 && minutes < 1440 ? minutes : 0;
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
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
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(() => router.refresh(), 500);
      return () => clearTimeout(timer);
    }
  }, [state?.success, router]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="quietHoursEnabled" value={enabledChecked ? 'on' : 'off'} />
      <input
        type="hidden"
        name="quietHoursWeekendAllDay"
        value={weekendChecked ? 'on' : 'off'}
      />
      <input type="hidden" name="quietHoursStart" value={startTime} />
      <input type="hidden" name="quietHoursEnd" value={endTime} />

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Moon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quiet-hours-switch" className="text-base font-semibold">
                Quiet Hours
              </Label>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Pause disruptive LOW-urgency alerts on your personal schedule.
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

        <div className="flex items-start gap-2 border-t bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            <span className="font-medium text-foreground">How it works:</span> Your start-to-end
            window applies every day. Turn on all-day weekends to extend quiet hours through all of
            Saturday and Sunday. When it is off, the regular time window still applies on weekends.
          </p>
        </div>

        {enabledChecked && (
          <div className="space-y-5 border-t bg-muted/20 p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(16rem,1.35fr)]">
              <div className="space-y-2 rounded-lg border bg-background p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Label htmlFor="quiet-hours-start">Starts at</Label>
                </div>
                <Input
                  id="quiet-hours-start"
                  type="time"
                  value={startTime}
                  onChange={event => setStartTime(event.target.value)}
                  className="w-full"
                />
              </div>
              <div className="space-y-2 rounded-lg border bg-background p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Label htmlFor="quiet-hours-end">Ends at</Label>
                </div>
                <Input
                  id="quiet-hours-end"
                  type="time"
                  value={endTime}
                  onChange={event => setEndTime(event.target.value)}
                  className="w-full"
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-4">
                <div>
                  <Label htmlFor="quiet-hours-weekend" className="text-sm">
                    Quiet all day on weekends
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Otherwise, the regular time window applies.
                  </p>
                </div>
                <Switch
                  id="quiet-hours-weekend"
                  checked={weekendChecked}
                  onCheckedChange={setWeekendChecked}
                />
              </div>
            </div>

            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <p className="flex items-start gap-2 rounded-lg bg-background/70 p-3">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Scheduled in <span className="font-medium text-foreground">{timeZone}</span>, the
                  timezone configured above.
                </span>
              </p>
              <p className="flex items-start gap-2 rounded-lg bg-background/70 p-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>MEDIUM/HIGH urgency, email, and in-app notifications always continue.</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {(state?.error || state?.success) && (
        <div
          className={`p-3 rounded-lg text-sm ${state?.error ? 'bg-destructive/10 text-destructive' : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'}`}
        >
          {state?.error ? state.error : 'Quiet-hours preferences saved successfully'}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          {isPending ? 'Saving...' : 'Save Quiet Hours'}
        </Button>
      </div>
    </form>
  );
}
