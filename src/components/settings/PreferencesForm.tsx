'use client';

import { useState, useEffect } from 'react';
import { AutosaveForm } from '@/components/settings/forms/AutosaveForm';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import TimeZoneSelect from '@/components/TimeZoneSelect';
import { Clock } from 'lucide-react';
import { z } from 'zod';
import { updatePreferences } from '@/app/(app)/settings/actions';
import { useRouter } from 'next/navigation';
import { Controller } from 'react-hook-form';
import { notify as toast } from '@/lib/toast';

type Props = {
  timeZone: string;
};

const preferencesSchema = z.object({
  timeZone: z.string(),
});

type PreferencesFormData = z.infer<typeof preferencesSchema>;

export default function PreferencesForm({ timeZone }: Props) {
  const router = useRouter();
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');
  const [selectedTimeZone, setSelectedTimeZone] = useState<string>(timeZone);

  // Live digital clock in selected timezone
  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: selectedTimeZone || 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour12: true,
        });
        setCurrentTimeStr(formatter.format(now));
      } catch (_e) {
        setCurrentTimeStr('');
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [selectedTimeZone]);

  const defaultValues: PreferencesFormData = {
    timeZone,
  };

  const handleSave = async (data: PreferencesFormData) => {
    const formData = new FormData();
    formData.append('timeZone', data.timeZone);

    const result = await updatePreferences({ error: null, success: false }, formData);

    if (result.success) {
      toast.success('Timezone updated');
      setTimeout(() => {
        router.refresh();
      }, 500);
    } else {
      toast.error(result.error || 'Failed to update timezone');
    }

    return {
      success: result.success ?? false,
      error: result.error ?? undefined,
    };
  };

  return (
    <AutosaveForm
      defaultValues={defaultValues}
      schema={preferencesSchema}
      onSave={handleSave}
      showSaveIndicator={true}
      saveIndicatorPosition="top-right"
      delay={500}
    >
      {form => (
        <div className="flex flex-col gap-0">
          <SettingsRow
            label="Timezone"
            description="Select your primary timezone"
            tooltip="Used for incident timestamps, on-call schedules, and quiet hours"
            htmlFor="timeZone"
          >
            <div className="w-full sm:max-w-md">
              <Controller
                control={form.control}
                name="timeZone"
                render={({ field }) => (
                  <TimeZoneSelect
                    name={field.name}
                    defaultValue={field.value}
                    onChange={value => {
                      field.onChange(value);
                      setSelectedTimeZone(value);
                    }}
                  />
                )}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            label="Current Local Time"
            description="Live clock in your selected timezone"
          >
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-mono text-foreground">
                {currentTimeStr || 'Loading...'}
              </span>
            </div>
          </SettingsRow>
        </div>
      )}
    </AutosaveForm>
  );
}
