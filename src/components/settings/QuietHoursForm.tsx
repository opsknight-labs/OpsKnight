'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateQuietHoursPreferences } from '@/app/(app)/settings/quiet-hours-actions';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Clock3, Info, Moon, ShieldCheck, Sun, Loader2, Save } from 'lucide-react';
import { notify as toast } from '@/lib/toast';
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
      toast.success('Quiet hours saved successfully');
      const timer = setTimeout(() => router.refresh(), 500);
      return () => clearTimeout(timer);
    }
    if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="quietHoursEnabled" value={enabledChecked ? 'on' : 'off'} />
      <input type="hidden" name="quietHoursWeekendAllDay" value={weekendChecked ? 'on' : 'off'} />
      <input type="hidden" name="quietHoursStart" value={startTime} />
      <input type="hidden" name="quietHoursEnd" value={endTime} />

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Switch Header */}
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 gap-3.5">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                enabledChecked ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              )}
            >
              <Moon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="quiet-hours-switch"
                  className="text-base font-semibold cursor-pointer"
                >
                  Personal Quiet Hours
                </Label>
                {enabledChecked ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[10px]">
                    Off
                  </Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Pause non-critical and LOW-urgency notification disruptions during your resting
                schedule.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-auto">
            <Switch
              id="quiet-hours-switch"
              checked={enabledChecked}
              onCheckedChange={setEnabledChecked}
            />
          </div>
        </div>

        {/* Explainability Banner */}
        <div className="flex items-start gap-2.5 border-t bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            <strong className="text-foreground font-medium">Failsafe Alerting Rule:</strong> High
            and Critical urgency incidents, active on-call escalations, and SLA breach warnings will{' '}
            <strong className="text-foreground font-medium">always bypass quiet hours</strong> to
            protect your systems.
          </p>
        </div>

        {enabledChecked && (
          <div className="space-y-5 border-t bg-card p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Start Time */}
              <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Moon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  <Label htmlFor="quiet-hours-start" className="cursor-pointer">
                    Starts at (Sleep)
                  </Label>
                </div>
                <Input
                  id="quiet-hours-start"
                  type="time"
                  value={startTime}
                  onChange={event => setStartTime(event.target.value)}
                  className="w-full bg-background font-mono text-sm"
                />
              </div>

              {/* End Time */}
              <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  <Label htmlFor="quiet-hours-end" className="cursor-pointer">
                    Ends at (Wakeup)
                  </Label>
                </div>
                <Input
                  id="quiet-hours-end"
                  type="time"
                  value={endTime}
                  onChange={event => setEndTime(event.target.value)}
                  className="w-full bg-background font-mono text-sm"
                />
              </div>

              {/* Weekend Toggle */}
              <div className="flex flex-col justify-between rounded-xl border bg-muted/20 p-4 sm:col-span-2 lg:col-span-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label
                      htmlFor="quiet-hours-weekend"
                      className="text-xs font-semibold cursor-pointer"
                    >
                      All-Day Quiet on Weekends
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      Silences LOW alerts all through Saturday and Sunday.
                    </p>
                  </div>
                  <Switch
                    id="quiet-hours-weekend"
                    checked={weekendChecked}
                    onCheckedChange={setWeekendChecked}
                  />
                </div>
              </div>
            </div>

            {/* Visual Schedule Pills */}
            <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="flex items-center gap-2 rounded-lg bg-muted/40 p-3">
                <Clock3 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  Evaluated in <strong className="text-foreground font-mono">{timeZone}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-muted/40 p-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>Critical alerts will always override quiet hours</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="gap-2 w-full sm:w-auto">
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving Quiet Hours...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Quiet Hours Schedule
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
