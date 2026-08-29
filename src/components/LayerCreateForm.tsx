'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { CheckCircle2, Layers, Loader2, Plus, UserRound, Users, X } from 'lucide-react';
import ResponderCombobox, { type ResponderOption } from './ResponderCombobox';
import LayerTimingFields from '@/components/schedules/LayerTimingFields';
import LayerRestrictionsFields from '@/components/schedules/LayerRestrictionsFields';

type LayerCreateFormProps = {
  scheduleId: string;
  canManageSchedules: boolean;
  createLayer: (scheduleId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  defaultStartDate: string;
  timeZone: string;
  users: ResponderOption[];
};

export default function LayerCreateForm({
  scheduleId,
  canManageSchedules,
  createLayer,
  defaultStartDate,
  timeZone,
  users,
}: LayerCreateFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Form state
  const [rotationDuration, setRotationDuration] = useState<string>('168');
  const [shiftDuration, setShiftDuration] = useState<string>('');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startHour, setStartHour] = useState<string>('');
  const [endHour, setEndHour] = useState<string>('');
  const [selectedResponderIds, setSelectedResponderIds] = useState<string[]>([]);
  const [configureRespondersLater, setConfigureRespondersLater] = useState(false);

  // Computed preview info
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    // Add selected days to form data
    selectedDays.forEach(day => {
      formData.append('daysOfWeek', day.toString());
    });
    selectedResponderIds.forEach(userId => formData.append('responderIds', userId));

    startTransition(async () => {
      try {
        const result = await createLayer(scheduleId, formData);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Layer created successfully', 'success');
          setOpen(false);
          // Reset form state
          setSelectedDays([]);
          setStartHour('');
          setEndHour('');
          setShiftDuration('');
          setSelectedResponderIds([]);
          setConfigureRespondersLater(false);
          router.refresh();
        }
      } catch {
        showToast('Failed to create layer', 'error');
      }
    });
  };

  if (!canManageSchedules) return null;

  const selectedResponders = users.filter(user => selectedResponderIds.includes(user.id));
  const availableResponders = users.filter(user => !selectedResponderIds.includes(user.id));
  const canSubmit = selectedResponderIds.length > 0 || configureRespondersLater;
  const coverageSummary =
    selectedDays.length === 0 && !startHour && !endHour
      ? '24/7 coverage'
      : 'Custom coverage window';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="h-10 w-full gap-2 text-sm font-medium shadow-sm sm:w-auto">
          <Plus className="h-4 w-4" />
          Add Rotation
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <SheetTitle className="text-lg font-semibold">Add rotation layer</SheetTitle>
              <SheetDescription>Set up a clear, active handoff layer.</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Layer identity</h3>
                  <p className="text-xs text-muted-foreground">
                    Use a name responders will recognize quickly.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Layer name</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="Primary on-call"
                  required
                  autoFocus
                  disabled={isPending}
                  className="h-11"
                />
              </div>
            </section>

            <section className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">Responders</h3>
                    <span className="text-xs text-muted-foreground">
                      Required for active coverage
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Add people in the order they should take this layer.
                  </p>
                </div>
                <ResponderCombobox
                  users={availableResponders}
                  onSelect={userId => {
                    setSelectedResponderIds(current => [...current, userId]);
                    setConfigureRespondersLater(false);
                  }}
                  disabled={isPending}
                  label="Add responder"
                />
              </div>
              {selectedResponders.length > 0 ? (
                <div className="space-y-2">
                  {selectedResponders.map((responder, index) => (
                    <div
                      key={responder.id}
                      className="flex items-center justify-between rounded-lg bg-muted/[0.45] px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">
                        <span className="mr-2 text-xs text-muted-foreground">{index + 1}.</span>
                        {responder.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setSelectedResponderIds(current =>
                            current.filter(userId => userId !== responder.id)
                          )
                        }
                        aria-label={`Remove ${responder.name}`}
                        disabled={isPending}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={configureRespondersLater}
                    onChange={event => setConfigureRespondersLater(event.target.checked)}
                    disabled={isPending}
                    className="mt-0.5"
                  />
                  <span>
                    Configure responders later. This saves the layer without coverage until people
                    are added.
                  </span>
                </label>
              )}
            </section>

            <LayerTimingFields
              rotationDuration={rotationDuration}
              onRotationDurationChange={setRotationDuration}
              shiftDuration={shiftDuration}
              onShiftDurationChange={setShiftDuration}
              startDefaultValue={defaultStartDate}
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
            />

            <div className="rounded-lg border border-primary/15 bg-primary/[0.04] p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                Layer summary
              </div>
              <p className="mt-1">
                {selectedResponderIds.length > 0
                  ? `${selectedResponderIds.length} responder${selectedResponderIds.length === 1 ? '' : 's'} will rotate ${rotationInfo?.toLowerCase() ?? ''}.`
                  : 'This layer will be saved without responders.'}{' '}
                {coverageSummary}.
              </p>
            </div>
          </div>

          <div className="flex gap-3 border-t bg-background px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-10 flex-1 shadow-sm"
              disabled={isPending || !canSubmit}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : selectedResponderIds.length > 0 ? (
                'Create active layer'
              ) : (
                'Save layer setup'
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
