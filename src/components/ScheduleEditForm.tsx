'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Edit3, Globe2, Loader2, Save, Tag, X } from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { useToast } from '@/hooks/use-product-notification';
import type { ScheduleActionState } from '@/lib/schedule-action-errors';
import TimeZoneSelect from './TimeZoneSelect';

type ScheduleEditFormProps = {
  scheduleId: string;
  currentName: string;
  currentTimeZone: string;
  updateSchedule: (
    scheduleId: string,
    formData: FormData
  ) => Promise<ScheduleActionState | undefined>;
  canManageSchedules: boolean;
};

export default function ScheduleEditForm({
  scheduleId,
  currentName,
  currentTimeZone,
  updateSchedule,
  canManageSchedules,
}: ScheduleEditFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await updateSchedule(scheduleId, formData);
        if (result?.error) {
          showToast(result, 'error');
          return;
        }
        showToast('Schedule updated successfully', 'success');
        setIsEditing(false);
        router.refresh();
      } catch (error) {
        showToast(error, 'error');
      }
    });
  };

  if (!canManageSchedules) return null;

  if (!isEditing) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-500/15 bg-blue-500/[0.05] p-4">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <Tag className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-wide">Schedule name</p>
            </div>
            <p className="mt-2 truncate text-base font-semibold text-foreground">{currentName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Used in on-call and escalation views.
            </p>
          </div>
          <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.05] p-4">
            <div className="flex items-center gap-2 text-violet-700 dark:text-violet-300">
              <Globe2 className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-wide">Schedule timezone</p>
            </div>
            <p className="mt-2 truncate text-base font-semibold text-foreground">
              {currentTimeZone}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Used for every handoff and coverage window.
            </p>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-3 rounded-lg border bg-muted/[0.18] p-3 sm:flex-row sm:items-center">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            Changes apply to the whole schedule; existing layer coverage rules stay unchanged.
          </p>
          <Button type="button" size="sm" onClick={() => setIsEditing(true)} className="gap-2">
            <Edit3 className="h-3.5 w-3.5" />
            Edit settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/[0.045] p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Edit3 className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Edit schedule details</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keep the name recognizable and the timezone aligned with the team’s handoff hours.
          </p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="schedule-name">Schedule name</Label>
          <Input
            id="schedule-name"
            name="name"
            defaultValue={currentName}
            required
            disabled={isPending}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            Make it easy to identify in an escalation.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="schedule-timezone">Schedule timezone</Label>
          <TimeZoneSelect name="timeZone" defaultValue={currentTimeZone} disabled={isPending} />
          <p className="text-xs text-muted-foreground">
            All handoffs and coverage hours use this zone.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-900 dark:text-amber-200">
        Changing the timezone changes how every layer’s dates and daily coverage hours are shown.
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsEditing(false)}
          disabled={isPending}
        >
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
        <Button type="submit" disabled={isPending} className="min-w-32">
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save settings
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
