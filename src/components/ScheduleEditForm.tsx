'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Edit3, Globe2, Layers3, Loader2, Save, ShieldCheck, Tag, X } from 'lucide-react';

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
      <div className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-primary/20 bg-primary/[0.055] p-4 md:p-5">
            <div className="flex items-center gap-2 text-primary">
              <Tag className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-wide">Schedule name</p>
            </div>
            <p className="mt-3 truncate text-lg font-semibold tracking-tight text-foreground">
              {currentName}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Used in on-call and escalation views.
            </p>
          </div>
          <div className="rounded-xl border border-primary/15 bg-muted/35 p-4 md:p-5">
            <div className="flex items-center gap-2 text-primary">
              <Globe2 className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-wide">Schedule timezone</p>
            </div>
            <p className="mt-3 truncate text-lg font-semibold tracking-tight text-foreground">
              {currentTimeZone}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Used for every handoff and coverage window.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.045] p-4 md:p-5">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <Layers3 className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-wide">
                Coverage configuration
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">
              Managed in Rotation &amp; Overrides
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Layers and temporary coverage stay separate from schedule details.
            </p>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-primary/10 bg-gradient-to-r from-primary/[0.05] to-transparent p-4 sm:flex-row sm:items-center md:px-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-emerald-500/10 p-1 text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-sm font-medium">Only schedule-wide details live here</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Updates apply everywhere; existing layer coverage rules stay unchanged.
              </p>
            </div>
          </div>
          <Button type="button" onClick={() => setIsEditing(true)} className="gap-2 sm:shrink-0">
            <Edit3 className="h-4 w-4" />
            Edit schedule settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.065] p-4 md:p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Edit3 className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-base font-semibold">Edit schedule details</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keep the name recognizable and the timezone aligned with the team’s handoff hours.
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
        <div className="rounded-xl border bg-card p-4 md:p-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-name">Schedule name</Label>
              <Input
                id="schedule-name"
                name="name"
                defaultValue={currentName}
                required
                disabled={isPending}
                className="h-11 border-primary/20 focus-visible:ring-primary/30"
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
        </div>
        <aside className="space-y-3">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-amber-950 dark:text-amber-100">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Globe2 className="h-4 w-4" />
              Timezone affects every layer
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">
              Changing it updates how layer dates and recurring coverage hours are shown.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.045] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
              Coverage stays intact
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              This does not edit responders, layer order, or temporary overrides.
            </p>
          </div>
        </aside>
      </div>

      <div className="flex justify-end gap-2 border-t border-primary/10 pt-5">
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
