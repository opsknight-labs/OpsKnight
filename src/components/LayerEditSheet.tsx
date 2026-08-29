'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Edit3, Loader2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/shadcn/sheet';
import LayerRestrictionsFields from '@/components/schedules/LayerRestrictionsFields';
import LayerTimingFields from '@/components/schedules/LayerTimingFields';
import { useToast } from '@/hooks/use-product-notification';
import { formatDateForInput } from '@/lib/timezone';

type LayerRestrictions = {
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
};

type LayerEditSheetProps = {
  layer: {
    id: string;
    name: string;
    start: Date;
    end: Date | null;
    rotationLengthHours: number;
    shiftLengthHours?: number | null;
    restrictions?: LayerRestrictions | null;
  };
  timeZone: string;
  updateLayer: (layerId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function LayerEditSheet({
  layer,
  timeZone,
  updateLayer,
  open,
  onOpenChange,
}: LayerEditSheetProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [rotationDuration, setRotationDuration] = useState(layer.rotationLengthHours.toString());
  const [shiftDuration, setShiftDuration] = useState(layer.shiftLengthHours?.toString() || '');
  const [selectedDays, setSelectedDays] = useState<number[]>(layer.restrictions?.daysOfWeek || []);
  const [startHour, setStartHour] = useState(layer.restrictions?.startHour?.toString() || '');
  const [endHour, setEndHour] = useState(layer.restrictions?.endHour?.toString() || '');

  const rotationInfo = useMemo(() => {
    const hours = parseInt(rotationDuration) || 0;
    if (hours <= 0) return null;
    if (hours < 24) return `${hours} hour rotation`;
    if (hours === 24) return 'Daily rotation';
    if (hours === 168) return 'Weekly rotation';
    if (hours === 336) return 'Bi-weekly rotation';
    if (hours % 24 === 0) return `${hours / 24} day rotation`;
    return `${hours} hour rotation`;
  }, [rotationDuration]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    selectedDays.forEach(day => formData.append('daysOfWeek', day.toString()));

    startTransition(async () => {
      try {
        const result = await updateLayer(layer.id, formData);
        if (result?.error) {
          showToast(result.error, 'error');
          return;
        }
        showToast('Layer updated successfully', 'success');
        onOpenChange(false);
        router.refresh();
      } catch {
        showToast('Failed to update layer', 'error');
      }
    });
  };

  const hasRestrictions = selectedDays.length > 0 || Boolean(startHour) || Boolean(endHour);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Edit3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-lg font-semibold">Edit rotation layer</SheetTitle>
              <SheetDescription className="truncate">
                Update the handoff rules for {layer.name}.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Layer name</h3>
                  <p className="text-xs text-muted-foreground">
                    Keep the name clear for responders and schedule owners.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`name-${layer.id}`}>Layer name</Label>
                <Input
                  id={`name-${layer.id}`}
                  name="name"
                  defaultValue={layer.name}
                  placeholder="Primary on-call"
                  required
                  disabled={isPending}
                  className="h-11"
                />
              </div>
            </section>

            <LayerTimingFields
              rotationDuration={rotationDuration}
              onRotationDurationChange={setRotationDuration}
              shiftDuration={shiftDuration}
              onShiftDurationChange={setShiftDuration}
              startDefaultValue={formatDateForInput(layer.start, timeZone)}
              endDefaultValue={layer.end ? formatDateForInput(layer.end, timeZone) : ''}
              disabled={isPending}
              rotationSummary={rotationInfo}
              timeZone={timeZone}
            />

            <LayerRestrictionsFields
              selectedDays={selectedDays}
              onSelectedDaysChange={setSelectedDays}
              startHour={startHour}
              onStartHourChange={setStartHour}
              endHour={endHour}
              onEndHourChange={setEndHour}
              disabled={isPending}
              defaultOpen={hasRestrictions}
            />
          </div>

          <div className="flex gap-3 border-t bg-background px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-10 flex-1 shadow-sm" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
