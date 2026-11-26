'use client';

import { useState, useTransition } from 'react';
import { notify as toast } from '@/lib/toast';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Switch } from '@/components/ui/shadcn/switch';
import { setMyServiceReviews } from '@/app/(app)/settings/service-review-actions';

/** The signed-in person's opt-in to the monthly service review for their teams' services. */
export default function ServiceReviewToggle({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const onChange = (next: boolean) => {
    setChecked(next);
    startTransition(async () => {
      try {
        const result = await setMyServiceReviews(next);
        if (!result.success) {
          setChecked(!next);
          toast.error(result.error);
          return;
        }
        toast.success(
          next ? 'Monthly service review turned on' : 'Monthly service review turned off'
        );
      } catch (error) {
        setChecked(!next);
        toast.error(error instanceof Error ? error.message : 'Could not save. Try again.');
      }
    });
  };
  return (
    <SettingsSection
      title="Monthly service review"
      description="One email on the first of the month for the business services of your teams that an admin included, ordered by what needs attention."
    >
      <SettingsRow
        label="Email me the monthly service review"
        description="Off by default. Only services you can already see are included, never one email per service."
      >
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={pending}
          aria-label="Email me the monthly service review"
        />
      </SettingsRow>
    </SettingsSection>
  );
}
