import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, PhoneCall, ShieldCheck } from 'lucide-react';
import MobileTime from '@/components/mobile/MobileTime';
import NewIncidentButton from '@/components/mobile/NewIncidentButton';
import { Card } from '@/components/ui/shadcn/card';
import { formatDurationShort } from '@/lib/mobile-time';
import { logger } from '@/lib/logger';
import { getResponderDashboardSnapshot } from '@/lib/dashboard/responder-dashboard-snapshot';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

export default async function MobileDashboard() {
  const context = await getRequestActorContext();
  if (!context) redirect('/login?callbackUrl=/m');

  const snapshot = await getResponderDashboardSnapshot(context.actor, context.user.id).catch(error => {
    logger.error('mobile.dashboard.snapshotUnavailable', {
      component: 'MobileDashboard',
      error,
    });
    return null;
  });

  const firstName = context.user.name?.trim().split(/\s+/)[0] || 'there';
  const timeZone = context.user.timeZone || 'UTC';
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(new Date())
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (!snapshot) {
    return (
      <div className="responsive-page space-y-4 px-3 py-4 sm:px-4">
        <Card className="rounded-2xl border-amber-300/70 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
          <strong className="text-sm">Operational summary is temporarily unavailable.</strong>
          <p className="mt-1 text-xs leading-relaxed opacity-80">
            Incident actions are still available. OpsKnight is not substituting unknown metrics with zeroes.
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-2.5">
          <NewIncidentButton />
          <Link
            href="/m/incidents"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-sm"
          >
            View incidents
          </Link>
        </div>
      </div>
    );
  }

  const currentScheduleId =
    snapshot.currentOnCallShift?.scheduleId || snapshot.currentOnCallShift?.schedule.id;
  const currentScheduleHref = currentScheduleId ? `/m/schedules/${currentScheduleId}` : '/m/schedules';

  return (
    <div className="responsive-page space-y-5 px-3 py-4 sm:px-4">
      <section className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">Responder workspace</p>
          <h1 className="mt-1 truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Focus on what needs action now.</p>
        </div>
        <div className="shrink-0">
          <NewIncidentButton />
        </div>
      </section>

      {snapshot.currentOnCallShift ? (
        <Link href={currentScheduleHref}>
          <Card className="rounded-2xl border-emerald-500/20 bg-emerald-500/5 p-4 shadow-sm transition hover:bg-emerald-500/10">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <PhoneCall className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">You are on call</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {snapshot.currentOnCallShift.schedule.name} · until{' '}
                  <MobileTime value={snapshot.currentOnCallShift.end} format="shift-end" />
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
          </Card>
        </Link>
      ) : (
        <Card className="rounded-2xl border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">No active on-call shift</p>
              <p className="mt-0.5 text-xs text-muted-foreground">You can still respond to incidents you can access.</p>
            </div>
          </div>
        </Card>
      )}

      <section aria-labelledby="mobile-priority-heading" className="space-y-2.5">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 id="mobile-priority-heading" className="text-sm font-bold text-foreground">Needs attention</h2>
          <Link href="/m/incidents?filter=all_open" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary">
            All active <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Link href="/m/incidents?filter=all_open&urgency=HIGH" className="min-w-0">
            <Card className="h-full rounded-2xl border-red-500/20 bg-red-500/5 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{snapshot.criticalIncidents}</span>
                <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden="true" />
              </div>
              <p className="mt-2 text-xs font-semibold text-foreground">High urgency</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Active now</p>
            </Card>
          </Link>
          <Link href="/m/incidents?filter=open" className="min-w-0">
            <Card className="h-full rounded-2xl border-border bg-card p-4 shadow-sm">
              <span className="text-2xl font-bold tabular-nums text-foreground">{snapshot.openIncidents}</span>
              <p className="mt-2 text-xs font-semibold text-foreground">Triggered</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Awaiting ACK</p>
            </Card>
          </Link>
          <Link href="/m/incidents?filter=acknowledged" className="min-w-0">
            <Card className="h-full rounded-2xl border-border bg-card p-4 shadow-sm">
              <span className="text-2xl font-bold tabular-nums text-foreground">{snapshot.acknowledgedIncidents}</span>
              <p className="mt-2 text-xs font-semibold text-foreground">Acknowledged</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Being worked</p>
            </Card>
          </Link>
          <Link href="/m/incidents?filter=muted" className="min-w-0">
            <Card className="h-full rounded-2xl border-border bg-card p-4 shadow-sm">
              <span className="text-2xl font-bold tabular-nums text-foreground">{snapshot.mutedIncidents}</span>
              <p className="mt-2 text-xs font-semibold text-foreground">Muted</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Snoozed/suppressed</p>
            </Card>
          </Link>
        </div>
      </section>

      <section aria-labelledby="mobile-active-heading" className="space-y-2.5">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 id="mobile-active-heading" className="text-sm font-bold text-foreground">Active incidents</h2>
          <span className="text-[11px] text-muted-foreground">
            Updated <MobileTime value={snapshot.generatedAt} format="time" />
            {snapshot.freshness === 'stale' ? ' · refreshing' : ''}
          </span>
        </div>

        {snapshot.activeIncidents.length === 0 ? (
          <Card className="rounded-2xl border-dashed border-border bg-card px-5 py-10 text-center shadow-none">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mt-3 text-sm font-bold text-foreground">No active incidents</h3>
            <p className="mt-1 text-xs text-muted-foreground">Nothing currently needs responder action.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {snapshot.activeIncidents.map(incident => (
              <Link key={incident.id} href={`/m/incidents/${incident.id}`} className="block min-w-0">
                <Card className="rounded-2xl border-border bg-card p-4 shadow-sm transition hover:bg-accent/30 active:scale-[0.995]">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${incident.urgency === 'HIGH' ? 'bg-red-500' : incident.status === 'OPEN' ? 'bg-amber-500' : 'bg-slate-400'}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <h3 className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">{incident.title}</h3>
                        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{formatDurationShort(incident.createdAt)}</span>
                      </div>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="truncate">{incident.service.name}</span>
                        <span aria-hidden="true">•</span>
                        <span>{incident.status}</span>
                        <span aria-hidden="true">•</span>
                        <span>{incident.urgency || 'NORMAL'}</span>
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Card className="rounded-2xl border-border bg-muted/30 p-4 shadow-none">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Resolved last 24h
          </span>
          <strong className="tabular-nums text-foreground">{snapshot.resolved24h}</strong>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            Current active backlog
          </span>
          <strong className="tabular-nums text-foreground">{snapshot.totalActive}</strong>
        </div>
      </Card>

      <Link href="/api/prefer-desktop" className="block min-h-11 py-3 text-center text-xs font-semibold text-muted-foreground hover:text-foreground">
        Switch to desktop workspace
      </Link>
    </div>
  );
}
