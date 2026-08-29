'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, Save, Settings2 } from 'lucide-react';

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
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
  const [name, setName] = useState(currentName);
  const [timeZone, setTimeZone] = useState(currentTimeZone);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  useEffect(() => {
    setTimeZone(currentTimeZone);
  }, [currentTimeZone]);

  const isDirty = name.trim() !== currentName || timeZone !== currentTimeZone;

  const handleReset = () => {
    setName(currentName);
    setTimeZone(currentTimeZone);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDirty || isPending || !name.trim()) return;

    const formData = new FormData();
    formData.set('name', name.trim());
    formData.set('timeZone', timeZone);

    startTransition(async () => {
      try {
        const result = await updateSchedule(scheduleId, formData);
        if (result?.error) {
          showToast(result, 'error');
          return;
        }
        showToast('Schedule settings updated successfully', 'success');
        router.refresh();
      } catch (error) {
        showToast(error, 'error');
      }
    });
  };

  if (!canManageSchedules) return null;

  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="border-b bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings2 className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Schedule settings</CardTitle>
            <CardDescription className="text-xs sm:text-sm text-muted-foreground">
              Manage the schedule name and default time zone used for shifts and handoffs.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6 p-5 sm:p-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-name" className="text-sm font-medium">
                Schedule name
              </Label>
              <Input
                id="schedule-name"
                name="name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                disabled={isPending}
                placeholder="e.g. Primary On-Call"
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                The recognizable name used in on-call routing and escalation policies.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-timezone" className="text-sm font-medium">
                Time zone
              </Label>
              <TimeZoneSelect
                id="schedule-timezone"
                name="timeZone"
                defaultValue={timeZone}
                onChange={val => setTimeZone(val)}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                All handoffs, rotation shifts, and coverage hours are calculated in this zone.
              </p>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex items-center justify-between border-t bg-muted/20 px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2">
            {isDirty && (
              <Badge variant="warning" size="xs">
                Unsaved changes
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={isPending}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Discard
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !isDirty || !name.trim()}
              className="gap-1.5"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  Save changes
                </>
              )}
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
