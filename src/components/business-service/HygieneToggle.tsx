'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Switch } from '@/components/ui/shadcn/switch';
import { notify } from '@/lib/toast';
import { setHygieneEnabledAction } from '@/app/(app)/services/business/phase5b-actions';

/** Admin switch: weekly in-app reminders to owners about stale reviews and unreachable owners. */
export default function HygieneToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(enabled);
  const [isPending, startTransition] = useTransition();
  const change = (next: boolean) => {
    setValue(next);
    startTransition(async () => {
      const result = await setHygieneEnabledAction(next);
      if (!result.ok) {
        setValue(!next);
        notify.error(result.error);
        return;
      }
      notify.success(next ? 'Ownership reminders on' : 'Ownership reminders off');
      router.refresh();
    });
  };
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 text-sm">
      <div className="min-w-0">
        <p id="hygiene-toggle-label" className="font-medium">
          Ownership reminders
        </p>
        <p className="text-xs text-muted-foreground">
          Notify owners, at most once a week per issue, when a review is overdue, the owner is
          inactive or the owning team has no one on call.
        </p>
      </div>
      <Switch
        checked={value}
        disabled={isPending}
        onCheckedChange={change}
        aria-labelledby="hygiene-toggle-label"
      />
    </div>
  );
}
