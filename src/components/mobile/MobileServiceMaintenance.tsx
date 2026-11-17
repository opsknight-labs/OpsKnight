'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import MobileTime from '@/components/mobile/MobileTime';
import { notify } from '@/lib/toast';
import {
  createMaintenanceWindowAction,
  endMaintenanceWindowAction,
  type MaintenanceActionResult,
} from '@/app/(app)/services/[id]/maintenance-actions';

export type MobileMaintenanceWindow = {
  id: string;
  title: string;
  phase: 'ACTIVE' | 'UPCOMING';
  startsAt: string;
  endsAt: string;
  heldCount: number;
};

const QUICK_DURATIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1h' },
  { minutes: 120, label: '2h' },
  { minutes: 240, label: '4h' },
] as const;

const LIST_LIMIT = 5;

export default function MobileServiceMaintenance({
  serviceId,
  canManage,
  windows,
}: {
  serviceId: string;
  canManage: boolean;
  /** Active and upcoming windows only. */
  windows: MobileMaintenanceWindow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [minutes, setMinutes] = useState<number>(60);

  const sorted = [...windows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const active = sorted.find(w => w.phase === 'ACTIVE');
  const next = sorted.find(w => w.phase === 'UPCOMING');

  const run = (
    fn: () => Promise<MaintenanceActionResult>,
    success: string,
    onDone?: () => void
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        notify.success(success);
        onDone?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const onStart = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get('title') ?? '').trim();
    if (!title) {
      setError('Enter a title.');
      return;
    }
    const startsAt = new Date();
    run(
      () =>
        createMaintenanceWindowAction(serviceId, {
          title,
          serviceIds: [serviceId],
          startsAt,
          endsAt: new Date(startsAt.getTime() + minutes * 60_000),
        }),
      'Maintenance started',
      () => setFormOpen(false)
    );
  };

  return (
    <section aria-label="Maintenance" className="space-y-2">
      {active ? (
        <div
          role="status"
          className="rounded-xl border border-status-info-border/40 bg-status-info-soft p-3.5 text-status-info-deep dark:border-status-info/35 dark:bg-status-info/15 dark:text-blue-300"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <Wrench className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                In maintenance until <MobileTime value={active.endsAt} format="short" />
              </p>
              <p className="mt-0.5 break-words text-sm font-medium">{active.title}</p>
              <p className="mt-0.5 text-xs tabular-nums">
                {active.heldCount} alert{active.heldCount === 1 ? '' : 's'} held · nobody is paged
              </p>
            </div>
          </div>
          {canManage &&
            (confirmEnd ? (
              // Ending early releases held alerts for paging, so a stray tap must not do it.
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium">
                  End now? Alerts still firing will start paging.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl border-status-info-border/40 bg-background text-foreground hover:bg-muted"
                    disabled={isPending}
                    onClick={() => setConfirmEnd(false)}
                  >
                    Keep
                  </Button>
                  <Button
                    type="button"
                    className="h-11 rounded-xl"
                    disabled={isPending}
                    aria-label={`Confirm ending maintenance window ${active.title}`}
                    onClick={() =>
                      run(
                        () => endMaintenanceWindowAction(serviceId, active.id),
                        'Maintenance ended',
                        () => setConfirmEnd(false)
                      )
                    }
                  >
                    {isPending && (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    End now
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-11 w-full rounded-xl border-status-info-border/40 bg-background text-foreground hover:bg-muted"
                disabled={isPending}
                aria-label={`End maintenance window ${active.title} now`}
                onClick={() => setConfirmEnd(true)}
              >
                End now
              </Button>
            ))}
        </div>
      ) : (
        <div className="flex min-h-12 min-w-0 items-start gap-2.5 rounded-xl border border-border bg-card p-3.5 text-card-foreground">
          <CalendarClock
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          {next ? (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Maintenance starts <MobileTime value={next.startsAt} format="short" />
              </p>
              <p className="mt-0.5 break-words text-sm text-muted-foreground">{next.title}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No maintenance scheduled.</p>
          )}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <h2 className="px-3.5 pt-3 text-sm font-semibold text-foreground">Maintenance windows</h2>
          <ul className="mt-1">
            {sorted.slice(0, LIST_LIMIT).map((w, index) => (
              <li
                key={w.id}
                className={`flex min-h-11 min-w-0 items-center gap-2 px-3.5 py-2 text-xs ${index > 0 ? 'border-t border-border' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {w.title}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    <MobileTime value={w.startsAt} format="short" /> –{' '}
                    <MobileTime value={w.endsAt} format="short" />
                  </span>
                </span>
                <span
                  className={`inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-2xs font-semibold ${
                    w.phase === 'ACTIVE'
                      ? 'border-status-info-border/25 bg-status-info-soft text-status-info-deep dark:border-status-info/35 dark:bg-status-info/15 dark:text-blue-300'
                      : 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {w.phase === 'ACTIVE' ? 'In progress' : 'Scheduled'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage &&
        !active &&
        (formOpen ? (
          <form
            onSubmit={onStart}
            aria-label="Start maintenance"
            className="space-y-3 rounded-xl border border-border bg-card p-3.5"
          >
            <div className="space-y-1.5">
              <label
                htmlFor="mobile-maintenance-title"
                className="text-xs font-semibold text-foreground"
              >
                Title
              </label>
              <Input
                id="mobile-maintenance-title"
                name="title"
                required
                maxLength={200}
                placeholder="e.g. Database failover"
                className="h-11 text-foreground"
              />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-foreground">Duration</legend>
              <div className="grid grid-cols-4 gap-2">
                {QUICK_DURATIONS.map(d => (
                  <button
                    key={d.minutes}
                    type="button"
                    aria-pressed={minutes === d.minutes}
                    onClick={() => setMinutes(d.minutes)}
                    className={`h-11 min-w-0 rounded-xl border text-xs font-semibold transition-colors ${
                      minutes === d.minutes
                        ? 'border-status-info-border bg-status-info-soft text-status-info-deep'
                        : 'border-border bg-background text-foreground'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Starts now. New alerts are held and nobody is paged until it ends.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl text-foreground"
                onClick={() => {
                  setFormOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-11 rounded-xl" disabled={isPending}>
                {isPending && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Start
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-xl text-foreground"
            onClick={() => setFormOpen(true)}
          >
            <Wrench className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Start maintenance
          </Button>
        ))}

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
