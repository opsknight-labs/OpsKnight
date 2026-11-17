import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appRoutes } from '@/lib/app-routes';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  PhoneCall,
  ShieldCheck,
} from 'lucide-react';
import MobileTime from '@/components/mobile/MobileTime';
import MobileManualRefreshButton from '@/components/mobile/MobileManualRefreshButton';
import NewIncidentButton from '@/components/mobile/NewIncidentButton';
import { MobileUnavailableState } from '@/components/mobile/MobileRouteError';
import {
  MobileIconTile,
  MobileIncidentRow,
  MobileListCard,
  MobileListRow,
  MobileSection,
  mobileSectionLinkClass,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import RelativeTime from '@/components/patterns/RelativeTime';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { getResponderDashboardSnapshot } from '@/lib/dashboard/responder-dashboard-snapshot';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export default async function MobileDashboard() {
  await requirePageAccess('/m');
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m'));

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
        <MobileUnavailableState
          title="Operational summary is unavailable"
          message="Counts are hidden rather than shown as zero. Incident actions still work."
          backHref="/m/incidents"
          backLabel="View incidents"
        />
        <NewIncidentButton />
      </div>
    );
  }

  const currentScheduleId =
    snapshot.currentOnCallShift?.scheduleId || snapshot.currentOnCallShift?.schedule.id;
  const currentScheduleHref = currentScheduleId
    ? `/m/schedules/${currentScheduleId}`
    : '/m/schedules';
  const shift = toneClasses('shift');

  return (
    <div className="responsive-page space-y-5">
      <section className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-44">
          <h1 className="break-words text-xl font-bold tracking-tight text-foreground">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">What needs your attention right now.</p>
        </div>
        <NewIncidentButton />
      </section>

      <section aria-label="On-call status">
        {snapshot.currentOnCallShift ? (
          <Link
            href={currentScheduleHref}
            className={cn(
              'flex min-h-14 min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              shift.soft,
              shift.hoverBorder
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-shift text-white">
              <PhoneCall className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">You are on call</span>
              <span className="mt-0.5 block truncate text-xs opacity-90">
                {snapshot.currentOnCallShift.schedule.name} · until{' '}
                <MobileTime value={snapshot.currentOnCallShift.end} format="shift-end" />
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Link>
        ) : (
          <MobileListCard label="On-call status">
            <MobileListRow
              href="/m/schedules"
              leading={<MobileIconTile icon={ShieldCheck} />}
              title="No active on-call shift"
              subtitle="View schedules and upcoming rotations"
            />
          </MobileListCard>
        )}
      </section>

      <MobileSection
        id="mobile-priority"
        title="Needs attention"
        action={
          <Link href="/m/incidents?filter=all_open" className={mobileSectionLinkClass}>
            View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        <MobileListCard>
          <MobileListRow
            href="/m/incidents?filter=all_open&urgency=HIGH"
            leading={<MobileIconTile icon={AlertTriangle} tone="critical" />}
            title="High urgency"
            subtitle="Active incidents needing a priority response"
            trailing={
              <strong className="text-lg font-bold tabular-nums text-status-critical-deep dark:text-rose-300">
                {snapshot.criticalIncidents}
              </strong>
            }
          />
          <MobileListRow
            href="/m/incidents?filter=open"
            leading={<MobileIconTile icon={BellRing} tone="elevated" />}
            title="Waiting for acknowledgement"
            subtitle="Triggered incidents with no ACK yet"
            trailing={
              <strong className="text-lg font-bold tabular-nums text-foreground">
                {snapshot.openIncidents}
              </strong>
            }
          />
          <li className="grid grid-cols-2 divide-x divide-border bg-muted/30">
            <Link
              href="/m/incidents?filter=acknowledged"
              className="flex min-h-11 items-center justify-between gap-2 px-3.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span>Acknowledged</span>
              <strong className="text-sm tabular-nums text-foreground">
                {snapshot.acknowledgedIncidents}
              </strong>
            </Link>
            <Link
              href="/m/incidents?filter=muted"
              className="flex min-h-11 items-center justify-between gap-2 px-3.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span>Muted</span>
              <strong className="text-sm tabular-nums text-foreground">
                {snapshot.mutedIncidents}
              </strong>
            </Link>
          </li>
        </MobileListCard>
      </MobileSection>

      <MobileSection
        id="mobile-active"
        title="Active incidents"
        action={
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <span>
              Updated <RelativeTime date={snapshot.generatedAt} />
              {snapshot.freshness === 'stale' ? ' · refreshing' : ''}
            </span>
            <MobileManualRefreshButton label="Refresh active incidents" />
          </span>
        }
      >
        {snapshot.activeIncidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title="No active incidents"
            description="Nothing needs a responder right now. New pages will appear here first."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {snapshot.activeIncidents.map(incident => (
              <MobileIncidentRow
                key={incident.id}
                incident={{ ...incident, serviceName: incident.service.name }}
              />
            ))}
          </MobileListCard>
        )}
      </MobileSection>

      <MobileSection id="mobile-today" title="At a glance">
        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card">
          <div className="min-w-0 px-2 py-3 text-center">
            <strong className="block truncate text-xl font-bold tabular-nums text-foreground">
              {snapshot.totalActive}
            </strong>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">Active</span>
          </div>
          <div className="min-w-0 px-2 py-3 text-center">
            <strong className="block truncate text-xl font-bold tabular-nums text-status-critical-deep dark:text-rose-300">
              {snapshot.criticalIncidents}
            </strong>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">High</span>
          </div>
          <div className="min-w-0 px-2 py-3 text-center">
            <strong className="block truncate text-xl font-bold tabular-nums text-status-ok-deep dark:text-emerald-300">
              {snapshot.resolved24h}
            </strong>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              Resolved 24h
            </span>
          </div>
        </div>
      </MobileSection>

      <MobileListCard label="More views">
        <MobileListRow
          href="/m/analytics"
          title="Responder analytics"
          subtitle="MTTA, MTTR and SLA trends"
        />
      </MobileListCard>
    </div>
  );
}
