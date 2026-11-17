import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appRoutes } from '@/lib/app-routes';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Info,
  Megaphone,
  Wrench,
} from 'lucide-react';
import EmptyState from '@/components/patterns/EmptyState';
import RelativeTime from '@/components/patterns/RelativeTime';
import { toneClasses } from '@/components/patterns/status-tone';
import MobileTime from '@/components/mobile/MobileTime';
import { MobileUnavailableState } from '@/components/mobile/MobileRouteError';
import {
  MobileIconTile,
  MobileIncidentRow,
  MobileListCard,
  MobileListRow,
  MobileSection,
  MobileStatusDot,
  mobileSectionLinkClass,
} from '@/components/mobile/MobileList';
import type { StatusTone } from '@/lib/design/status-palette';
import { cn } from '@/lib/utils';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { getInternalOperationalStatusSnapshot } from '@/lib/status/internal-operational-status-snapshot';
import { logger } from '@/lib/logger';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

function statusMeta(status: string): {
  label: string;
  Icon: typeof CheckCircle2;
  tone: StatusTone;
} {
  if (status === 'MAJOR_OUTAGE') {
    return { label: 'Major outage', Icon: CircleAlert, tone: 'critical' };
  }
  if (status === 'PARTIAL_OUTAGE') {
    return { label: 'Degraded performance', Icon: AlertTriangle, tone: 'elevated' };
  }
  return { label: 'All systems operational', Icon: CheckCircle2, tone: 'ok' };
}

function announcementIcon(type: string) {
  if (type === 'MAINTENANCE') return Wrench;
  if (type === 'INCIDENT') return CircleAlert;
  if (type === 'INFO') return Info;
  return Megaphone;
}

export default async function MobileStatusPage() {
  await requirePageAccess('/m/status');
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m/status'));

  const snapshot = await getInternalOperationalStatusSnapshot(context.actor).catch(error => {
    logger.error('mobile.status.snapshotUnavailable', {
      component: 'MobileStatusPage',
      error,
    });
    return null;
  });

  if (!snapshot) {
    return (
      <div className="responsive-page">
        <MobileUnavailableState
          title="System health is unavailable"
          message="OpsKnight won't guess the operational state. Try again, or check the incident queue."
          backHref="/m/incidents"
          backLabel="View incidents"
        />
      </div>
    );
  }

  const overall = statusMeta(snapshot.overallStatus);
  const OverallIcon = overall.Icon;
  const impactedServices = snapshot.services.filter(service => service.status !== 'OPERATIONAL');

  const overallTone = toneClasses(overall.tone);

  return (
    <div className="responsive-page space-y-5">
      <section
        className={cn('rounded-xl border p-4', overallTone.soft)}
        aria-labelledby="health-overall-heading"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/60">
            <OverallIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="health-overall-heading" className="text-base font-semibold">
              {overall.label}
            </h2>
            <p className="mt-0.5 text-sm tabular-nums">
              {snapshot.counts.activeIncidents === 0
                ? 'No active incidents'
                : `${snapshot.counts.activeIncidents} active incident${snapshot.counts.activeIncidents === 1 ? '' : 's'}`}
            </p>
          </div>
          <span className="shrink-0 text-right text-xs">
            <RelativeTime date={snapshot.generatedAt} />
            {snapshot.freshness === 'stale' ? <span className="block">refreshing</span> : null}
          </span>
        </div>
      </section>

      <MobileSection id="health-overview" title="Services">
        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card">
          {(
            [
              ['Operational', snapshot.counts.operational, 'ok'],
              ['Degraded', snapshot.counts.degraded, 'elevated'],
              ['Major', snapshot.counts.major, 'critical'],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="px-2 py-3 text-center">
              <strong
                className={cn('block text-xl font-bold tabular-nums', toneClasses(tone).text)}
              >
                {value}
              </strong>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </MobileSection>

      {snapshot.announcements.length > 0 && (
        <MobileSection id="health-announcements" title="Announcements">
          <MobileListCard>
            {snapshot.announcements.map(announcement => {
              const Icon = announcementIcon(announcement.type);
              return (
                <li key={announcement.id} className="flex items-start gap-3 px-3.5 py-3">
                  <MobileIconTile icon={Icon} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-foreground">{announcement.title}</h3>
                    <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {announcement.message}
                    </p>
                    <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                      <MobileTime value={announcement.startDate} format="date" />
                      {announcement.endDate ? (
                        <>
                          {' '}
                          – <MobileTime value={announcement.endDate} format="date" />
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </MobileListCard>
        </MobileSection>
      )}

      <MobileSection
        id="health-impacted"
        title="Impacted services"
        count={impactedServices.length}
        action={
          <Link href="/m/services" className={mobileSectionLinkClass}>
            All services <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        {impactedServices.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title="Every visible service is operational"
            description="Services drop in here as soon as one of their incidents is triggered."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {impactedServices.map(service => {
              const meta = statusMeta(service.status);
              return (
                <MobileListRow
                  key={service.id}
                  href={`/m/services/${service.id}`}
                  leading={<MobileStatusDot tone={meta.tone} />}
                  title={service.name}
                  subtitle={meta.label}
                  trailing={
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {service.incidentCount} active
                    </span>
                  }
                />
              );
            })}
          </MobileListCard>
        )}
      </MobileSection>

      <MobileSection
        id="health-incidents"
        title="Active incidents"
        description={`${snapshot.counts.criticalIncidents} high urgency`}
      >
        {snapshot.activeIncidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title="No active incidents"
            description="There is no current operational impact."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {snapshot.activeIncidents.map(incident => (
              <MobileIncidentRow key={incident.id} incident={incident} />
            ))}
          </MobileListCard>
        )}
      </MobileSection>

      {snapshot.recentHistory.length > 0 && (
        <MobileSection id="health-history" title="Recently resolved">
          <MobileListCard>
            {snapshot.recentHistory.map(incident => (
              <MobileListRow
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                leading={<MobileIconTile icon={CheckCircle2} tone="ok" />}
                title={incident.title}
                subtitle={incident.serviceName}
                trailing={
                  <RelativeTime
                    date={incident.resolvedAt}
                    className="text-xs text-muted-foreground"
                  />
                }
              />
            ))}
          </MobileListCard>
        </MobileSection>
      )}
    </div>
  );
}
