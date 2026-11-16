'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarClock, Loader2, Plus, Repeat, Wrench } from 'lucide-react';
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
import TimeZoneSelect from '@/components/TimeZoneSelect';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  createMaintenanceScheduleAction,
  createMaintenanceWindowAction,
  deleteMaintenanceScheduleAction,
  deleteMaintenanceWindowAction,
  endMaintenanceWindowAction,
  updateMaintenanceScheduleAction,
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
  /** Materialised from a recurring schedule. */
  recurring: boolean;
};

export type MaintenanceScheduleView = {
  id: string;
  title: string;
  /** e.g. "Every Sunday 02:00–04:00 Asia/Kolkata". */
  summary: string;
  paused: boolean;
  nextLabel: string | null;
  serviceNames: string[];
};

type Props = {
  serviceId: string;
  canManage: boolean;
  windows: MaintenanceWindowView[];
  schedules: MaintenanceScheduleView[];
  services: { id: string; name: string }[];
  userTimeZone: string;
};

type RepeatMode = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INTERVAL_UNIT = new Map<RepeatMode, string>([
  ['DAILY', 'day(s)'],
  ['WEEKLY', 'week(s)'],
  ['MONTHLY', 'month(s)'],
]);

/** Today's calendar date and weekday in a time zone. */
function todayIn(timeZone: string): { date: string; weekday: number; day: number } {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = date.split('-').map(Number);
  return { date, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), day: d };
}

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
  userTimeZone,
}: {
  serviceId: string;
  services: Props['services'];
  userTimeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startNow, setStartNow] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set([serviceId]));
  const [publish, setPublish] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('NONE');
  const [timeZone, setTimeZone] = useState(userTimeZone);
  const today = useMemo(() => todayIn(timeZone), [timeZone]);
  const [weekdays, setWeekdays] = useState<Set<number>>(
    () => new Set([todayIn(userTimeZone).weekday])
  );
  const [endsOnDate, setEndsOnDate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const recurring = repeat !== 'NONE';

  const toggleWeekday = (day: number) =>
    setWeekdays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

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
    const common = {
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? '') || null,
      serviceIds: Array.from(selected),
      endBehavior: (form.get('endBehavior') === 'RESOLVE_HELD'
        ? 'RESOLVE_HELD'
        : 'RESUME_FIRING') as 'RESOLVE_HELD' | 'RESUME_FIRING',
      publishToStatusPage: publish,
    };
    if (repeat !== 'NONE') {
      startTransition(async () => {
        const result = await createMaintenanceScheduleAction(serviceId, {
          ...common,
          frequency: repeat,
          interval: Number(form.get('interval')) || 1,
          byWeekday: Array.from(weekdays),
          dayOfMonth: repeat === 'MONTHLY' ? Number(form.get('dayOfMonth')) : null,
          timeZone: String(form.get('timeZone') ?? timeZone),
          startTime: String(form.get('startTime') ?? ''),
          durationMinutes: Number(form.get('duration')),
          startsOn: String(form.get('startsOn') ?? ''),
          endsOn: endsOnDate ? String(form.get('endsOn') ?? '') || null : null,
        });
        if (result.ok) {
          notify.success('Recurring maintenance scheduled');
          setOpen(false);
        } else {
          setError(result.error);
        }
      });
      return;
    }
    const startsAt = startNow ? new Date() : new Date(String(form.get('startsAt') ?? ''));
    const minutes = Number(form.get('duration'));
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
    if (Number.isNaN(startsAt.getTime())) {
      setError('Choose a start time.');
      return;
    }
    startTransition(async () => {
      const result = await createMaintenanceWindowAction(serviceId, {
        ...common,
        startsAt,
        endsAt,
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

          <div className="space-y-1.5">
            <Label htmlFor="mw-repeat">Repeat</Label>
            <select
              id="mw-repeat"
              value={repeat}
              onChange={e => setRepeat(e.target.value as RepeatMode)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="NONE">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>

          {recurring ? (
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Recurrence</legend>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Label htmlFor="mw-interval" className="font-normal">
                  Every
                </Label>
                <Input
                  id="mw-interval"
                  name="interval"
                  type="number"
                  min={1}
                  max={52}
                  defaultValue={1}
                  required
                  className="h-9 w-20"
                />
                <span className="text-muted-foreground">{INTERVAL_UNIT.get(repeat)}</span>
              </div>

              {repeat === 'WEEKLY' && (
                <div role="group" aria-label="Repeat on" className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((label, day) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={weekdays.has(day)}
                      onClick={() => toggleWeekday(day)}
                      className={cn(
                        'h-8 min-w-11 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        weekdays.has(day)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {repeat === 'MONTHLY' && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Label htmlFor="mw-day-of-month" className="font-normal">
                    On day
                  </Label>
                  <Input
                    id="mw-day-of-month"
                    name="dayOfMonth"
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={today.day}
                    required
                    className="h-9 w-20"
                  />
                  <span className="text-xs text-muted-foreground">
                    Shorter months use their last day.
                  </span>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mw-starts-on">Starting</Label>
                  <Input
                    id="mw-starts-on"
                    name="startsOn"
                    type="date"
                    defaultValue={today.date}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mw-start-time">At</Label>
                  <Input
                    id="mw-start-time"
                    name="startTime"
                    type="time"
                    defaultValue="02:00"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label id="mw-timezone-label">Time zone</Label>
                <div role="group" aria-labelledby="mw-timezone-label">
                  <TimeZoneSelect
                    name="timeZone"
                    id="mw-timezone"
                    defaultValue={userTimeZone}
                    onChange={setTimeZone}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">Ends</span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="endsMode"
                      checked={!endsOnDate}
                      onChange={() => setEndsOnDate(false)}
                    />
                    Never
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="endsMode"
                      checked={endsOnDate}
                      onChange={() => setEndsOnDate(true)}
                    />
                    On
                  </label>
                  {endsOnDate && (
                    <Input
                      name="endsOn"
                      type="date"
                      min={today.date}
                      required
                      aria-label="End date"
                      className="h-9 w-auto"
                    />
                  )}
                </div>
              </div>
            </fieldset>
          ) : (
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
          )}

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
            <Button
              type="submit"
              disabled={
                isPending || selected.size === 0 || (repeat === 'WEEKLY' && weekdays.size === 0)
              }
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {recurring ? 'Schedule recurring' : startNow ? 'Start maintenance' : 'Schedule'}
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
          {window.recurring && (
            <Badge variant="outline" size="xs">
              <Repeat className="mr-1 h-3 w-3" aria-hidden="true" />
              Repeats
            </Badge>
          )}
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

function ScheduleRow({
  serviceId,
  schedule,
  canManage,
}: {
  serviceId: string;
  schedule: MaintenanceScheduleView;
  canManage: boolean;
}) {
  const { isPending, run } = useAction();
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{schedule.title}</span>
          {schedule.paused && (
            <Badge variant="outline" size="xs">
              Paused
            </Badge>
          )}
        </div>
        <p className="break-words text-sm text-muted-foreground">{schedule.summary}</p>
        <p className="text-xs text-muted-foreground">
          {schedule.paused
            ? 'No upcoming occurrences while paused'
            : schedule.nextLabel
              ? `Next: ${schedule.nextLabel}`
              : 'No further occurrences'}{' '}
          · {schedule.serviceNames.join(', ')}
        </p>
      </div>
      {canManage && (
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  updateMaintenanceScheduleAction(serviceId, schedule.id, {
                    paused: !schedule.paused,
                  }),
                schedule.paused ? 'Schedule resumed' : 'Schedule paused'
              )
            }
          >
            {schedule.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(() => deleteMaintenanceScheduleAction(serviceId, schedule.id), 'Schedule deleted')
            }
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

export default function ServiceMaintenancePanel({
  serviceId,
  canManage,
  windows,
  schedules,
  services,
  userTimeZone,
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
        {canManage && (
          <ScheduleDialog serviceId={serviceId} services={services} userTimeZone={userTimeZone} />
        )}
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

      {schedules.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
            Recurring schedules
          </h3>
          <ul className="space-y-3">
            {schedules.map(s => (
              <ScheduleRow key={s.id} serviceId={serviceId} schedule={s} canManage={canManage} />
            ))}
          </ul>
        </div>
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
