'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { updateQuietHoursPreferences } from '@/app/(app)/settings/quiet-hours-actions';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import { useAutosave } from '@/lib/hooks/use-autosave';
import QuietHoursTimeline from '@/components/settings/QuietHoursTimeline';

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

function timeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) % 1440;
}

export default function QuietHoursForm({
  enabled,
  startMinutes,
  endMinutes,
  weekendAllDay,
  timeZone,
}: Props) {
  const router = useRouter();

  const [enabledChecked, setEnabledChecked] = useState(enabled);
  const [weekendChecked, setWeekendChecked] = useState(weekendAllDay);
  const [startTime, setStartTime] = useState(minutesToTime(startMinutes));
  const [endTime, setEndTime] = useState(minutesToTime(endMinutes));

  // Derive dynamic minutes for real-time visual timeline feedback
  const dynamicStartMinutes = useMemo(() => timeToMinutes(startTime), [startTime]);
  const dynamicEndMinutes = useMemo(() => timeToMinutes(endTime), [endTime]);

  // Autosave quiet hours
  const handleAutoSave = useCallback(
    async (data: { enabled: boolean; start: string; end: string; weekend: boolean }) => {
      const formData = new FormData();
      formData.append('quietHoursEnabled', data.enabled ? 'on' : 'off');
      formData.append('quietHoursStart', data.start);
      formData.append('quietHoursEnd', data.end);
      formData.append('quietHoursWeekendAllDay', data.weekend ? 'on' : 'off');

      const result = await updateQuietHoursPreferences({ error: null, success: false }, formData);

      if (result.success) {
        router.refresh();
        return { success: true };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to save quiet hours',
        };
      }
    },
    [router]
  );

  const currentSettings = {
    enabled: enabledChecked,
    start: startTime,
    end: endTime,
    weekend: weekendChecked,
  };

  const { status: saveStatus, error: saveError } = useAutosave({
    data: currentSettings,
    onSave: handleAutoSave,
    delay: 500,
    enabled: true,
  });

  return (
    <div>
      <div className="flex justify-end pb-2">
        <SaveIndicator status={saveStatus} error={saveError} />
      </div>

      <SettingsRow
        label="Enable Quiet Hours"
        description="Silence low-urgency alerts (SMS, Push, WhatsApp) during specified hours"
      >
        <Switch checked={enabledChecked} onCheckedChange={setEnabledChecked} />
      </SettingsRow>

      {enabledChecked && (
        <>
          <SettingsRow label="Start Time" description="When quiet hours begin">
            <Input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="max-w-[160px]"
            />
          </SettingsRow>

          <SettingsRow label="End Time" description="When quiet hours end">
            <Input
              type="time"
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
          </SettingsRow>

          {/* Visual 24-Hour Timeline */}
          <QuietHoursTimeline
            startMinutes={dynamicStartMinutes}
            endMinutes={dynamicEndMinutes}
            enabled={enabledChecked}
            weekendAllDay={weekendChecked}
            timeZone={timeZone}
          />
        </>
      )}
    </div>
  );
}
