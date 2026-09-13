import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Info,
  Megaphone,
  Wrench,
} from 'lucide-react';
import { Card } from '@/components/ui/shadcn/card';
import EmptyState from '@/components/ui/EmptyState';
import MobileTime from '@/components/mobile/MobileTime';
import { IncidentStatusBadge, IncidentUrgencyBadge } from '@/components/incident/IncidentSemanticBadge';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { getInternalOperationalStatusSnapshot } from '@/lib/status/internal-operational-status-snapshot';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function statusMeta(status: string) {
  if (status === 'MAJOR_OUTAGE') {
    return {
      label: 'Major outage',
      Icon: CircleAlert,
      tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200',
      dot: 'bg-rose-500',
    };
  }
  if (status === 'PARTIAL_OUTAGE') {
    return {
      label: 'Degraded performance',
      Icon: AlertTriangle,
      tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
      dot: 'bg-amber-500',
    };
  }
  return {
    label: 'All systems operational',
    Icon: CheckCircle2,
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  };
}

function announcementIcon(type: string) {
  if (type === 'MAINTENANCE') return Wrench;
  if (type === 'INCIDENT') return CircleAlert;
  if (type === 'INFO') return Info;
  return Megaphone;
}

export default async function MobileStatusPage() {
  const context = await getRequestActorContext();
  if (!context) redirect('/login?callbackUrl=/m/status');

  const snapshot = await getInternalOperationalStatusSnapshot(context.actor).catch(error => {
    logger.error('mobile.status.snapshotUnavailable', {
      component: 'MobileStatusPage',
      error,
    });
    return null;
  });

  if (!snapshot) {
    return (
      <div className="responsive-page space-y-4">
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100"
        >
          <strong>System health is temporarily unavailable.</strong>
          <p className="mt-1 text-xs opacity-80">OpsKnight is not guessing the current operational state.</p>
        </div>
        <Link href="/m/incidents" className="inline-flex min-h-11 items-center text-sm font-semibold text-foreground">
          View incidents <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const overall = statusMeta(snapshot.overallStatus);
  const OverallIcon = overall.Icon;
  const impactedServices = snapshot.services.filter(service => service.status !== 'OPERATIONAL');

  return (
    <div className="responsive-page space-y-5">
      <section className={`rounded-xl border p-4 ${overall.tone}`} aria-label={`System status: ${overall.label}`}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-current/10">
            <OverallIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold">{overall.label}</h1>
            <p className="mt-0.5 text-[11px] opacity-75">
              {snapshot.counts.activeIncidents === 0
                ? 'No active incidents'
                : `${snapshot.counts.activeIncidents} active incident${snapshot.counts.activeIncidents === 1 ? '' : 's'}`}
            </p>
          </div>
          <span className="shrink-0 text-right text-[10px] opacity-70">
            <MobileTime value={snapshot.generatedAt} format="time" />
            {snapshot.freshness === 'stale' ? <span className="block">refreshing</span> : null}
          </span>
        </div>
      </section>

      <section aria-labelledby="health-overview-heading" className="space-y-2">
        <h2 id="health-overview-heading" className="px-0.5 text-sm font-bold text-foreground">Services</h2>
        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card">
          <div className="px-2 py-3 text-center">
            <strong className="block text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-300">{snapshot.counts.operational}</strong>
            <span className="text-[10px] text-muted-foreground">Operational</span>
          </div>
          <div className="px-2 py-3 text-center">
            <strong className="block text-base font-bold tabular-nums text-amber-600 dark:text-amber-300">{snapshot.counts.degraded}</strong>
            <span className="text-[10px] text-muted-foreground">Degraded</span>
          </div>
          <div className="px-2 py-3 text-center">
            <strong className="block text-base font-bold tabular-nums text-rose-600 dark:text-rose-300">{snapshot.counts.major}</strong>
            <span className="text-[10px] text-muted-foreground">Major</span>
          </div>
        </div>
      </section>

      {snapshot.announcements.length > 0 && (
        <section aria-labelledby="health-announcements-heading" className="space-y-2">
          <h2 id="health-announcements-heading" className="px-0.5 text-sm font-bold text-foreground">Announcements</h2>
          <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
            {snapshot.announcements.map((announcement, index) => {
              const Icon = announcementIcon(announcement.type);
              return (
                <article key={announcement.id} className={`flex items-start gap-3 px-3.5 py-3 ${index > 0 ? 'border-t border-border/70' : ''}`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[12px] font-semibold text-foreground">{announcement.title}</h3>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{announcement.message}</p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      <MobileTime value={announcement.startDate} format="date" />
                      {announcement.endDate ? (
                        <> – <MobileTime value={announcement.endDate} format="date" /></>
                      ) : null}
                    </p>
                  </div>
                </article>
              );
            })}
          </Card>
        </section>
      )}

      <section aria-labelledby="health-impacted-heading" className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 id="health-impacted-heading" className="text-sm font-bold text-foreground">Impacted services</h2>
          <Link href="/m/services" className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">All services</Link>
        </div>
        {impactedServices.length === 0 ? (
          <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            All visible services are operational.
          </div>
        ) : (
          <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
            {impactedServices.map((service, index) => {
              const meta = statusMeta(service.status);
              return (
                <Link
                  key={service.id}
                  href={`/m/services/${service.id}`}
                  className={`flex min-h-[58px] items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-foreground">{service.name}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{meta.label}</span>
                  </span>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {service.incidentCount} active
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      <section aria-labelledby="health-incidents-heading" className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 id="health-incidents-heading" className="text-sm font-bold text-foreground">Active incidents</h2>
          <span className="text-[10px] text-muted-foreground">{snapshot.counts.criticalIncidents} high urgency</span>
        </div>
        {snapshot.activeIncidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title="No active incidents"
            description="There is no current operational impact."
            size="sm"
          />
        ) : (
          <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
            {snapshot.activeIncidents.map((incident, index) => (
              <Link
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                className={`block px-3.5 py-3 transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <IncidentStatusBadge status={incident.status} />
                  <IncidentUrgencyBadge urgency={incident.urgency} />
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    <MobileTime value={incident.createdAt} format="relative-short" />
                  </span>
                </div>
                <h3 className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">{incident.title}</h3>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{incident.serviceName}</p>
              </Link>
            ))}
          </Card>
        )}
      </section>

      {snapshot.recentHistory.length > 0 && (
        <section aria-labelledby="health-history-heading" className="space-y-2">
          <h2 id="health-history-heading" className="px-0.5 text-sm font-bold text-foreground">Recent history</h2>
          <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
            {snapshot.recentHistory.map((incident, index) => (
              <Link
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                className={`flex min-w-0 items-center gap-3 px-3.5 py-3 transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-foreground">{incident.title}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{incident.serviceName}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  <MobileTime value={incident.resolvedAt} format="relative-short" />
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
