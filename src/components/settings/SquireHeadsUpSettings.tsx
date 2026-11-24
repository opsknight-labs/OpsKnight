'use client';

import { useId, useState, useTransition } from 'react';
import { notify as toast } from '@/lib/toast';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { fieldClass } from '@/components/settings/form-kit';
import { Switch } from '@/components/ui/shadcn/switch';
import { setMySquireHeadsUp } from '@/app/(app)/settings/profile/squire-heads-up-actions';

const LEAD_CHOICES = [15, 30, 60, 120] as const;

/** The person's own on-call heads-up from Squire: on by default, an hour before each shift. */
export default function SquireHeadsUpSettings({
  enabled,
  leadMinutes,
}: {
  enabled: boolean;
  leadMinutes: number;
}) {
  const [value, setValue] = useState({ enabled, leadMinutes });
  const [isPending, startTransition] = useTransition();
  const id = useId();

  const save = (next: typeof value) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      try {
        await setMySquireHeadsUp(next);
        toast.success(next.enabled ? 'On-call heads-up saved' : 'On-call heads-up turned off');
      } catch {
        setValue(previous);
        toast.error('Could not save. Try again.');
      }
    });
  };

  return (
    <SettingsSection
      title="On-call heads-up"
      description="Before your shift starts, Squire sends you a short briefing: open incidents on your services, recent changes and anything flagged. In the app, and as a Slack direct message when your Slack account is linked."
    >
      <SettingsRow label="Send me a heads-up before my shift">
        <Switch
          checked={value.enabled}
          onCheckedChange={checked => save({ ...value, enabled: checked })}
          disabled={isPending}
          aria-label="Send me an on-call heads-up before my shift"
        />
      </SettingsRow>
      <SettingsRow label="How long before" htmlFor={`${id}-lead`}>
        <select
          id={`${id}-lead`}
          className={`${fieldClass} w-auto`}
          value={value.leadMinutes}
          disabled={isPending || !value.enabled}
          onChange={event => save({ ...value, leadMinutes: Number(event.target.value) })}
        >
          {(LEAD_CHOICES as readonly number[]).includes(value.leadMinutes) ? null : (
            <option value={value.leadMinutes}>{value.leadMinutes} minutes</option>
          )}
          {LEAD_CHOICES.map(minutes => (
            <option key={minutes} value={minutes}>
              {minutes === 120 ? '2 hours' : `${minutes} minutes`}
            </option>
          ))}
        </select>
      </SettingsRow>
    </SettingsSection>
  );
}
