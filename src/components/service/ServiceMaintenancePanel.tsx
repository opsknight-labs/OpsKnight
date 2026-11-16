'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarClock, Loader2, Plus, Wrench } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { notify } from '@/lib/toast';
import {
  createMaintenanceWindowAction,
  deleteMaintenanceWindowAction,
  endMaintenanceWindowAction,
  updateMaintenanceWindowAction,
  type MaintenanceActionResult,
} from '@/app/(app)/services/[id]/maintenance-actions';

export type MaintenanceWindowView = {
  id: string;
  title: string;
  description: string | null;
  phase: 'UPCOMING' | 'ACTIVE' | 'ENDED';
  startsAt: string;
  endsAt: string;
  startsLabel: string;
  endsLabel: string;
  endBehavior: 'RESUME_FIRING' | 'RESOLVE_HELD';
  publishToStatusPage: boolean;
  serviceNames: string[];
  heldCount: number;
};

type Props = {
  serviceId: string;
  canManage: boolean;
  windows: MaintenanceWindowView[];
  services: { id: string; name: string }[];
};

const DURATIONS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
  { minutes: 1440, label: '24 hours' },
];

const PHASE_BADGE = {
  ACTIVE: { variant: 'info', label: 'In progress' },
  UPCOMING: { variant: 'neutral', label: 'Scheduled' },
  ENDED: { variant: 'outline', label: 'Completed' },
} as const;

function useAction() {
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<MaintenanceActionResult>, success: string, onDone?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        notify.success(success);
        onDone?.();
      } else {
        notify.error(result.error);
      }
    });
  return { isPending, run };
}

function ScheduleDialog({
  serviceId,
  services,
}: {
  serviceId: string;
  services: Props['services'];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startNow, setStartNow] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set([serviceId]));
  const [publish, setPublish] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggle = (id: string, checked: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const startsAt = startNow ? new Date() : new Date(String(form.get('startsAt') ?? ''));
    const minutes = Number(form.get('duration'));
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
    if (Number.isNaN(startsAt.getTime())) {
      setError('Choose a start time.');
      return;
    }
    startTransition(async () => {
      const result = await createMaintenanceWindowAction(serviceId, {
        title: String(form.get('title') ?? ''),
        description: String(form.get('description') ?? '') || null,
        serviceIds: Array.from(selected),
        startsAt,
        endsAt,
        endBehavior: form.get('endBehavior') === 'RESOLVE_HELD' ? 'RESOLVE_HELD' : 'RESUME_FIRING',
        publishToStatusPage: publish,
      });
      if (result.ok) {
        notify.success(startNow ? 'Maintenance started' : 'Maintenance scheduled');
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 px-3 text-xs font-semibold">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Schedule maintenance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule maintenance</DialogTitle>
          <DialogDescription>
            New alerts for the selected services are held as suppressed incidents. Nobody is paged
            until the window ends. Incidents already open keep escalating.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mw-title">Title</Label>
            <Input
              id="mw-title"
              name="title"
              required
              maxLength={200}
              placeholder="Database upgrade"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mw-description">Description (optional)</Label>
            <Textarea id="mw-description" name="description" maxLength={2000} rows={2} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Start</legend>
            <div className="flex items-center gap-2">
              <Switch id="mw-start-now" checked={startNow} onCheckedChange={setStartNow} />
              <Label htmlFor="mw-start-now">Start now</Label>
            </div>
            {!startNow && (
              <Input name="startsAt" type="datetime-local" required aria-label="Start time" />
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="mw-duration">Duration</Label>
            <select
              id="mw-duration"
              name="duration"
              defaultValue="60"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {DURATIONS.map(d => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Services ({selected.size})</legend>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {services.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.has(s.id)}
                    onCheckedChange={checked => toggle(s.id, checked === true)}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">When the window ends</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="endBehavior"
                value="RESUME_FIRING"
                defaultChecked
                className="mt-1"
              />
              <span>Page for alerts that are still firing (recommended)</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="endBehavior" value="RESOLVE_HELD" className="mt-1" />
              <span>Auto-resolve every held incident</span>
            </label>
          </fieldset>

          <div className="flex items-start gap-2">
            <Switch id="mw-publish" checked={publish} onCheckedChange={setPublish} />
            <Label htmlFor="mw-publish" className="font-normal">
              Show on status pages and notify their subscribers
            </Label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || selected.size === 0}>
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {startNow ? 'Start maintenance' : 'Schedule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WindowRow({
  serviceId,
  window,
  canManage,
}: {
  serviceId: string;
  window: MaintenanceWindowView;
  canManage: boolean;
}) {
  const { isPending, run } = useAction();
  const badge = PHASE_BADGE[window.phase];
  const extend = () =>
    run(
      () =>
        updateMaintenanceWindowAction(serviceId, window.id, {
          endsAt: new Date(new Date(window.endsAt).getTime() + 60 * 60_000),
        }),
      'Maintenance extended by 1 hour'
    );

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{window.title}</span>
          <Badge variant={badge.variant} size="xs">
            {badge.label}
          </Badge>
          {window.publishToStatusPage && (
            <Badge variant="outline" size="xs">
              Status page
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {window.startsLabel} → {window.endsLabel}
        </p>
        {window.description && <p className="text-sm">{window.description}</p>}
        <p className="text-xs text-muted-foreground">
          {window.serviceNames.join(', ')} ·{' '}
          {window.endBehavior === 'RESOLVE_HELD'
            ? 'auto-resolve held at end'
            : 'page still-firing at end'}{' '}
          · {window.heldCount} alert{window.heldCount === 1 ? '' : 's'} held
        </p>
      </div>
      {canManage && window.phase !== 'ENDED' && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" disabled={isPending} onClick={extend}>
            Extend 1h
          </Button>
          {window.phase === 'ACTIVE' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                run(() => endMaintenanceWindowAction(serviceId, window.id), 'Maintenance ended')
              }
            >
              End now
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                run(
                  () => deleteMaintenanceWindowAction(serviceId, window.id),
                  'Maintenance deleted'
                )
              }
            >
              Delete
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export default function ServiceMaintenancePanel({
  serviceId,
  canManage,
  windows,
  services,
}: Props) {
  const groups = useMemo(
    () => ({
      current: windows.filter(w => w.phase !== 'ENDED'),
      past: windows.filter(w => w.phase === 'ENDED'),
    }),
    [windows]
  );

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Wrench className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold">Maintenance windows</h2>
            <p className="text-sm text-muted-foreground">
              Hold alerts during planned work. Held incidents stay visible and are released or
              resolved when the window ends.
            </p>
          </div>
        </div>
        {canManage && <ScheduleDialog serviceId={serviceId} services={services} />}
      </div>

      {groups.current.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          No active or upcoming maintenance.
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.current.map(w => (
            <WindowRow key={w.id} serviceId={serviceId} window={w} canManage={canManage} />
          ))}
        </ul>
      )}

      {groups.past.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Recent</h3>
          <ul className="space-y-3">
            {groups.past.map(w => (
              <WindowRow key={w.id} serviceId={serviceId} window={w} canManage={false} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
