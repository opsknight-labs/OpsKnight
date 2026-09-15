import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  PhoneCall,
  ShieldCheck,
} from 'lucide-react';
import MobileTime from '@/components/mobile/MobileTime';
import NewIncidentButton from '@/components/mobile/NewIncidentButton';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';
import {
  IncidentStatusBadge,
  IncidentUrgencyBadge,
} from '@/components/incident/IncidentSemanticBadge';
import { formatDurationShort } from '@/lib/mobile-time';
import { logger } from '@/lib/logger';
import { getResponderDashboardSnapshot } from '@/lib/dashboard/responder-dashboard-snapshot';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

export default async function MobileDashboard() {
  const context = await getRequestActorContext();
  if (!context) redirect('/login?callbackUrl=/m');

  const snapshot = await getResponderDashboardSnapshot(context.actor, context.user.id).catch(
    error => {
      logger.error('mobile.dashboard.snapshotUnavailable', {
        component: 'MobileDashboard',
        error,
      });
      return null;
    }
  );

  const firstName = context.user.name?.trim().split(/\s+/)[0] || 'there';
  const timeZone = context.user.timeZone || 'UTC';
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(
      new Date()
    )
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (!snapshot) {
    return (
      <div className="responsive-page space-y-4">
        <Card
          className="rounded-xl border-amber-300/70 bg-amber-50 p-4 text-amber-950 shadow-none dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          <strong className="text-sm">Operational summary is temporarily unavailable.</strong>
          <p className="mt-1 text-xs leading-relaxed opacity-80">
            Incident actions remain available. Unknown metrics are not being shown as zero.
          </p>
        </Card>
        <div className="flex flex-wrap gap-2">
          <NewIncidentButton />
          <Link
            href="/m/incidents"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground"
          >
            View incidents
          </Link>
        </div>
      </div>
    );
  }

  const currentScheduleId =
    snapshot.currentOnCallShift?.scheduleId || snapshot.currentOnCallShift?.schedule.id;
  const currentScheduleHref = currentScheduleId
    ? `/m/schedules/${currentScheduleId}`
    : '/m/schedules';

  return (
    <div className="responsive-page space-y-5">
      <section className="flex min-w-0 flex-wrap items-start justify-between gap-3 pt-0.5">
        <div className="min-w-0 flex-1 basis-44">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Responder workspace
          </p>
          <h1 className="mt-1 break-words text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">What needs your attention right now.</p>
        </div>
        <NewIncidentButton />
      </section>

      <section aria-label="On-call status">
        {snapshot.currentOnCallShift ? (
          <Link
            href={currentScheduleHref}
            className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-3.5 py-3 text-foreground transition-colors hover:bg-violet-50 dark:border-violet-900/60 dark:bg-violet-950/25 dark:hover:bg-violet-950/35"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
              <PhoneCall className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold">You are on call</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {snapshot.currentOnCallShift.schedule.name} · until{' '}
                <MobileTime value={snapshot.currentOnCallShift.end} format="shift-end" />
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ) : (
          <Link
            href="/m/schedules"
            className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-foreground transition-colors hover:bg-accent/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold">No active on-call shift</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                View schedules and upcoming rotations
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        )}
      </section>

      <section aria-labelledby="mobile-priority-heading" className="space-y-2.5">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 id="mobile-priority-heading" className="text-sm font-bold text-foreground">
            Needs attention
          </h2>
          <Link
            href="/m/incidents?filter=all_open"
            className="inline-flex min-h-10 items-center text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            View all <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          <Link
            href="/m/incidents?filter=all_open&urgency=HIGH"
            className="flex min-h-14 items-center gap-3 border-b border-border/70 px-3.5 py-3 transition-colors hover:bg-rose-50/60 dark:hover:bg-rose-950/20"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-foreground">High urgency</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Active incidents requiring priority response
              </span>
            </span>
            <strong className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-300">
              {snapshot.criticalIncidents}
            </strong>
          </Link>

          <Link
            href="/m/incidents?filter=open"
            className="flex min-h-14 items-center gap-3 px-3.5 py-3 transition-colors hover:bg-accent/40"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
              <BellRing className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-foreground">
                Waiting for acknowledgement
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Triggered incidents with no ACK yet
              </span>
            </span>
            <strong className="text-lg font-bold tabular-nums text-foreground">
              {snapshot.openIncidents}
            </strong>
          </Link>

          <div className="grid grid-cols-2 border-t border-border/70 bg-muted/20">
            <Link
              href="/m/incidents?filter=acknowledged"
              className="flex min-h-11 items-center justify-between gap-2 border-r border-border/70 px-3 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <span>Acknowledged</span>
              <strong className="tabular-nums text-foreground">
                {snapshot.acknowledgedIncidents}
              </strong>
            </Link>
            <Link
              href="/m/incidents?filter=muted"
              className="flex min-h-11 items-center justify-between gap-2 px-3 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <span>Muted</span>
              <strong className="tabular-nums text-foreground">{snapshot.mutedIncidents}</strong>
            </Link>
          </div>
        </Card>
      </section>

      <section aria-labelledby="mobile-active-heading" className="space-y-2.5">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 id="mobile-active-heading" className="text-sm font-bold text-foreground">
            Active incidents
          </h2>
          <span className="text-[10px] text-muted-foreground">
            <MobileTime value={snapshot.generatedAt} format="time" />
            {snapshot.freshness === 'stale' ? ' · refreshing' : ''}
          </span>
        </div>

        {snapshot.activeIncidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title="No active incidents"
            description="Nothing currently needs responder action."
            size="sm"
          />
        ) : (
          <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
            {snapshot.activeIncidents.map((incident, index) => (
              <Link
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                className={`block min-w-0 px-3.5 py-3 transition-colors hover:bg-accent/40 ${
                  index > 0 ? 'border-t border-border/70' : ''
                }`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <IncidentStatusBadge status={incident.status} />
                      <IncidentUrgencyBadge urgency={incident.urgency} />
                      <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">
                        {formatDurationShort(incident.createdAt)}
                      </span>
                    </div>
                    <h3 className="mt-1.5 line-clamp-2 break-words text-[13px] font-semibold leading-snug text-foreground">
                      {incident.title}
                    </h3>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {incident.service.name}
                    </p>
                  </div>
                  <ArrowRight
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            ))}
          </Card>
        )}
      </section>

      <section aria-labelledby="mobile-today-heading" className="space-y-2.5">
        <h2 id="mobile-today-heading" className="px-0.5 text-sm font-bold text-foreground">
          Today
        </h2>
        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card">
          <div className="min-w-0 px-2 py-3 text-center sm:px-3">
            <strong className="block truncate text-base font-bold tabular-nums text-foreground">
              {snapshot.totalActive}
            </strong>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">Active</span>
          </div>
          <div className="min-w-0 px-2 py-3 text-center sm:px-3">
            <strong className="block truncate text-base font-bold tabular-nums text-rose-600 dark:text-rose-300">
              {snapshot.criticalIncidents}
            </strong>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">High</span>
          </div>
          <div className="min-w-0 px-2 py-3 text-center sm:px-3">
            <strong className="block truncate text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
              {snapshot.resolved24h}
            </strong>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              Resolved
            </span>
          </div>
        </div>
      </section>

      <Link
        href="/m/analytics"
        className="flex min-h-11 items-center justify-between rounded-xl px-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          View responder analytics
        </span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
