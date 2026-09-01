'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateQuietHoursPreferences } from '@/app/(app)/settings/quiet-hours-actions';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Loader2, Save } from 'lucide-react';
import { notify as toast } from '@/lib/toast';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';

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
    <form action={formAction}>
      <SettingsRow
        label="Enable Quiet Hours"
        description="Silence non-critical alerts during specified hours"
      >
        <Switch checked={enabledChecked} onCheckedChange={setEnabledChecked} />
        <input type="hidden" name="quietHoursEnabled" value={enabledChecked ? 'on' : 'off'} />
      </SettingsRow>

      {enabledChecked && (
        <>
          <SettingsRow label="Start Time" description="When quiet hours begin">
            <Input
              type="time"
              name="quietHoursStart"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="max-w-[160px]"
            />
          </SettingsRow>

          <SettingsRow label="End Time" description="When quiet hours end">
            <Input
              type="time"
              name="quietHoursEnd"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="max-w-[160px]"
            />
          </SettingsRow>

          <SettingsRow
            label="Weekend All Day"
            description="Extend quiet hours to all day on weekends"
          >
            <Switch checked={weekendChecked} onCheckedChange={setWeekendChecked} />
            <input
              type="hidden"
              name="quietHoursWeekendAllDay"
              value={weekendChecked ? 'on' : 'off'}
            />
          </SettingsRow>
        </>
      )}

      <div className="flex justify-end py-4">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Schedule
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
