'use client';

import { useMemo, useState, useTransition } from 'react';
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
import { Label } from '@/components/ui/shadcn/label';
import ResponderCombobox, { type ResponderOption } from './ResponderCombobox';
import { formatDateForInput, formatDateTime, parseDateTimeInTimeZone } from '@/lib/timezone';
import { AlertCircle, Clock, Loader2, ShieldPlus, UserRoundCog } from 'lucide-react';
import { cn } from '@/lib/utils';

type OverrideFormProps = {
  scheduleId: string;
  users: ResponderOption[];
  canCreateOverride: boolean;
  createOverride: (
    scheduleId: string,
    formData: FormData
  ) => Promise<{ error?: string } | undefined>;
  scheduleTimeZone: string;
};

type OverrideMode = 'replacement' | 'additive';

export default function OverrideForm({
  scheduleId,
  users,
  canCreateOverride,
  createOverride,
  scheduleTimeZone,
}: OverrideFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<OverrideMode>('replacement');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [replacesUserId, setReplacesUserId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const replacementCandidates = useMemo(
    () => users.filter(user => user.id !== selectedUserId),
    [selectedUserId, users]
  );
  const startInstant = useMemo(
    () => parseDateTimeInTimeZone(startTime, scheduleTimeZone),
    [scheduleTimeZone, startTime]
  );
  const endInstant = useMemo(
    () => parseDateTimeInTimeZone(endTime, scheduleTimeZone),
    [endTime, scheduleTimeZone]
  );
  const hasValidRange = Boolean(startInstant && endInstant && endInstant > startInstant);

  const handleQuickDuration = (hours: number) => {
    const start = new Date();
    const minutesToQuarter = (15 - (start.getMinutes() % 15)) % 15;
    start.setMinutes(start.getMinutes() + minutesToQuarter, 0, 0);
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setStartTime(formatDateForInput(start, scheduleTimeZone));
    setEndTime(formatDateForInput(end, scheduleTimeZone));
  };

  const reset = () => {
    setMode('replacement');
    setSelectedUserId('');
    setReplacesUserId('');
    setStartTime('');
    setEndTime('');
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUserId) return showToast('Select the responder taking coverage.', 'error');
    if (mode === 'replacement' && !replacesUserId) {
      return showToast('Select the responder being replaced.', 'error');
    }
    if (!hasValidRange) {
      return showToast('Enter a valid schedule-timezone range with end after start.', 'error');
    }

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await createOverride(scheduleId, formData);
        if (result?.error) return showToast(result.error, 'error');
        showToast(
          mode === 'replacement' ? 'Replacement created.' : 'Extra coverage added.',
          'success'
        );
        reset();
        setOpen(false);
        router.refresh();
      } catch {
        showToast('Failed to create override.', 'error');
      }
    });
  };

  if (!canCreateOverride) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="gap-2">
          <ShieldPlus className="h-4 w-4" />
          Add override
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b pb-4 text-left">
          <SheetTitle>Add coverage override</SheetTitle>
          <SheetDescription>
            Times are interpreted in {scheduleTimeZone}, regardless of your browser timezone.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-5">
          <input type="hidden" name="userId" value={selectedUserId} />
          <input
            type="hidden"
            name="replacesUserId"
            value={mode === 'replacement' ? replacesUserId : ''}
          />
          <input type="hidden" name="start" value={startTime} />
          <input type="hidden" name="end" value={endTime} />

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">What should change?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  value: 'replacement' as const,
                  title: 'Replace someone',
                  description: 'Swap one scheduled responder for another.',
                  icon: UserRoundCog,
                },
                {
                  value: 'additive' as const,
                  title: 'Add extra coverage',
                  description: 'Add a responder without removing anyone.',
                  icon: ShieldPlus,
                },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => {
                    setMode(option.value);
                    if (option.value === 'additive') setReplacesUserId('');
                  }}
                  className={cn(
                    'rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    mode === option.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:border-primary/50'
                  )}
                >
                  <option.icon className="mb-2 h-5 w-5 text-primary" />
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label>Responder taking coverage</Label>
            <ResponderCombobox
              users={users}
              selectedUserId={selectedUserId}
              onSelect={setSelectedUserId}
              label="Select responder"
              className="w-full justify-between"
              disabled={isPending}
            />
          </div>

          {mode === 'replacement' && (
            <div className="space-y-2">
              <Label>Responder being replaced</Label>
              <ResponderCombobox
                users={replacementCandidates}
                selectedUserId={replacesUserId}
                onSelect={setReplacesUserId}
                label="Select scheduled responder"
                className="w-full justify-between"
                disabled={isPending}
              />
            </div>
          )}

          <div className="space-y-3">
            <Label>Quick duration</Label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 4, 8, 24].map(hours => (
                <Button
                  key={hours}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickDuration(hours)}
                >
                  {hours}h
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="override-start">Starts</Label>
              <input
                id="override-start"
                type="datetime-local"
                value={startTime}
                onChange={event => setStartTime(event.target.value)}
                required
                disabled={isPending}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="override-end">Ends</Label>
              <input
                id="override-end"
                type="datetime-local"
                value={endTime}
                onChange={event => setEndTime(event.target.value)}
                required
                disabled={isPending}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {startTime && endTime && (
            <div
              className={cn(
                'rounded-lg border p-3 text-sm',
                hasValidRange ? 'bg-muted/40' : 'border-destructive/40 bg-destructive/5'
              )}
            >
              <div className="flex items-center gap-2 font-medium">
                {hasValidRange ? (
                  <Clock className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )}
                {hasValidRange ? 'Schedule-timezone preview' : 'Invalid or ambiguous local time'}
              </div>
              {startInstant && endInstant && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(startInstant, scheduleTimeZone, { format: 'short' })} →{' '}
                  {formatDateTime(endInstant, scheduleTimeZone, { format: 'short' })}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                !selectedUserId ||
                !hasValidRange ||
                (mode === 'replacement' && !replacesUserId)
              }
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'replacement' ? 'Create replacement' : 'Add coverage'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
