'use client';

import { useState, useEffect } from 'react';
import { AutosaveForm } from '@/components/settings/forms/AutosaveForm';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import TimeZoneSelect from '@/components/TimeZoneSelect';
import { Clock, Globe2 } from 'lucide-react';
import { z } from 'zod';
import { updatePreferences } from '@/app/(app)/settings/actions';
import { useRouter } from 'next/navigation';
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
      } catch (e) {
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
        <div className="divide-y">
          <SettingsRow
            label="Preferred Timezone"
            description="All incident timestamps, on-call schedules, and SLA charts will render in this timezone"
            htmlFor="timeZone"
          >
            <div className="space-y-3 max-w-md">
              <TimeZoneSelect
                name="timeZone"
                defaultValue={form.watch('timeZone')}
                onChange={value => {
                  form.setValue('timeZone', value);
                  setSelectedTimeZone(value);
                }}
              />

              {currentTimeStr && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>
                    Current Local Time:{' '}
                    <strong className="text-foreground font-mono">{currentTimeStr}</strong>
                  </span>
                </div>
              )}
            </div>
          </SettingsRow>
        </div>
      )}
    </AutosaveForm>
  );
}
