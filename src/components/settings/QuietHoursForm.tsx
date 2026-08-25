'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateQuietHoursPreferences } from '@/app/(app)/settings/quiet-hours-actions';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';

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
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="quietHoursEnabled" value={enabledChecked ? 'on' : 'off'} />
      <input
        type="hidden"
        name="quietHoursWeekendAllDay"
        value={weekendChecked ? 'on' : 'off'}
      />
      <input type="hidden" name="quietHoursStart" value={startTime} />
      <input type="hidden" name="quietHoursEnd" value={endTime} />

      <SettingsRow
        label="Quiet hours"
        description="Mute disruptive LOW-urgency alerts during your local quiet hours."
        tooltip="Push, SMS and WhatsApp are muted. MEDIUM/HIGH urgency, email and in-app notifications still deliver."
      >
        <div className="w-full max-w-xl space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="quiet-hours-switch"
              checked={enabledChecked}
              onCheckedChange={setEnabledChecked}
            />
            <Label htmlFor="quiet-hours-switch" className="text-sm">
              {enabledChecked ? 'Enabled' : 'Disabled'}
            </Label>
          </div>

          {enabledChecked && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quiet-hours-start">Start time</Label>
                  <Input
                    id="quiet-hours-start"
                    type="time"
                    value={startTime}
                    onChange={event => setStartTime(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quiet-hours-end">End time</Label>
                  <Input
                    id="quiet-hours-end"
                    type="time"
                    value={endTime}
                    onChange={event => setEndTime(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="quiet-hours-weekend" className="text-sm">
                    Mute all day on weekends
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Saturday and Sunday are treated as quiet hours for LOW urgency.
                  </p>
                </div>
                <Switch
                  id="quiet-hours-weekend"
                  checked={weekendChecked}
                  onCheckedChange={setWeekendChecked}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Times use your profile timezone: <span className="font-medium">{timeZone}</span>.
                Change it under General Preferences if needed.
              </p>
            </div>
          )}
        </div>
      </SettingsRow>

      {(state?.error || state?.success) && (
        <div
          className={`p-3 rounded-lg text-sm ${state?.error ? 'bg-destructive/10 text-destructive' : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'}`}
        >
          {state?.error ? state.error : 'Quiet-hours preferences saved successfully'}
        </div>
      )}

      <div className="pt-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : 'Save Quiet Hours'}
        </Button>
      </div>
    </form>
  );
}
