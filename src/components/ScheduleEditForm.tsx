'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import TimeZoneSelect from './TimeZoneSelect';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Edit, Loader2, Save, X } from 'lucide-react';

type ScheduleEditFormProps = {
  scheduleId: string;
  currentName: string;
  currentTimeZone: string;
  updateSchedule: (
    scheduleId: string,
    formData: FormData
  ) => Promise<{ error?: string } | undefined>;
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await updateSchedule(scheduleId, formData);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Schedule updated successfully', 'success');
          setIsEditing(false);
          router.refresh();
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        showToast(errorMessage || 'Failed to update schedule', 'error');
      }
    });
  };

  if (!canManageSchedules) {
    return null;
  }

  if (!isEditing) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3">
          <div className="space-y-2 text-xs text-slate-500">
            <div>
              <span className="uppercase tracking-wide">Name</span>
              <div className="text-sm font-semibold text-slate-800">{currentName}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-wide">Timezone</span>
              <Badge variant="outline" size="xs">
                {currentTimeZone}
              </Badge>
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="gap-2 bg-primary text-white hover:bg-primary/90 shadow-sm"
        >
          <Edit className="h-4 w-4" />
          Edit Schedule Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200/80 bg-white p-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="schedule-name" className="text-sm">
            Schedule Name
          </Label>
          <Input
            id="schedule-name"
            name="name"
            defaultValue={currentName}
            required
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="schedule-timezone" className="text-sm">
            Time Zone
          </Label>
          <TimeZoneSelect name="timeZone" defaultValue={currentTimeZone} disabled={isPending} />
          <p className="text-xs text-muted-foreground">
            All times in this schedule will be displayed in the selected timezone
          </p>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending} className="flex-1 gap-2">
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsEditing(false)}
            disabled={isPending}
            className="gap-2"
          >
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
