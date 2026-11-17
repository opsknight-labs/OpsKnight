import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Activity, ArrowRight, BarChart3 } from 'lucide-react';
import { appRoutes } from '@/lib/app-routes';
import EmptyState from '@/components/patterns/EmptyState';
import RelativeTime from '@/components/patterns/RelativeTime';
import { Card } from '@/components/ui/shadcn/card';
import { MobileUnavailableState } from '@/components/mobile/MobileRouteError';
import {
  MobileIncidentRow,
  MobileListCard,
  MobileSection,
  mobileSectionLinkClass,
} from '@/components/mobile/MobileList';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { getResponderAnalyticsSnapshot } from '@/lib/dashboard/responder-analytics-snapshot';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type RangeDays = 7 | 30 | 90;

function normalizeRange(value?: string): RangeDays {
  return value === '7' ? 7 : value === '30' ? 30 : 90;
}

function formatDuration(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return '--';
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  return `${(rounded / 60).toFixed(1)}h`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value)}%`;
}

function ProgressLine({
  value,
  tone = 'slate',
}: {
  value: number;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue';
}) {
  const width = Math.max(0, Math.min(100, value));
  const toneClass =
    tone === 'emerald'
      ? 'bg-status-ok'
      : tone === 'amber'
        ? 'bg-status-elevated'
        : tone === 'rose'
          ? 'bg-status-critical'
          : tone === 'blue'
            ? 'bg-status-info'
            : 'bg-ink-500';
  return (
    <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default async function MobileAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  await requirePageAccess('/m/analytics');
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m/analytics'));

  const params = await searchParams;
  const range = normalizeRange(params?.range);
  const snapshot = await getResponderAnalyticsSnapshot(context.actor, range).catch(error => {
    logger.error('mobile.analytics.snapshotUnavailable', {
      component: 'MobileAnalyticsPage',
      range,
      error,
    });
    return null;
  });

  if (!snapshot) {
    return (
      <div className="responsive-page">
        <MobileUnavailableState
          title="Analytics are unavailable"
          message="Metrics are hidden rather than shown as zero. Try again in a moment."
          backHref="/m/incidents"
          backLabel="View incidents"
        />
      </div>
    );
  }

  const { metrics } = snapshot;
  const dayMs = 24 * 60 * 60 * 1000;
  const effectiveWindowDays = Math.max(
    1,
    Math.ceil((metrics.effectiveEnd.getTime() - metrics.effectiveStart.getTime()) / dayMs)
  );
  const displayRange = metrics.isClipped ? effectiveWindowDays : range;
  const trendSeries = metrics.trendSeries.slice(-7);
  const trendMax = Math.max(1, ...trendSeries.map(point => point.count));
  const topServices = metrics.topServices.slice(0, 5);
  const assigneeLoad = metrics.assigneeLoad.slice(0, 5);
  const recentIncidents = (metrics.recentIncidents || []).slice(0, 6);

  return (
    <div className="responsive-page space-y-5">
      <section className="flex items-center justify-between gap-3">
        <nav className="inline-flex rounded-lg bg-muted p-0.5" aria-label="Analytics range">
          {([7, 30, 90] as const).map(days => (
            <Link
              key={days}
              href={days === 90 ? '/m/analytics' : `/m/analytics?range=${days}`}
              className={cn(
                'inline-flex min-h-11 min-w-12 items-center justify-center rounded-md px-3 text-sm font-medium tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                range === days
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-ink-600 hover:text-foreground'
              )}
              aria-current={range === days ? 'page' : undefined}
              aria-label={`Last ${days} days`}
            >
              {days}d
            </Link>
          ))}
        </nav>
        <span className="text-xs text-muted-foreground">
          Updated <RelativeTime date={snapshot.generatedAt} />
          {snapshot.freshness === 'stale' ? ' · refreshing' : ''}
        </span>
      </section>

      {metrics.isClipped && (
        <div
          role="note"
          className="rounded-xl border border-status-info-border/25 bg-status-info-soft px-3 py-2 text-xs text-status-info-deep dark:border-status-info/35 dark:bg-status-info/15 dark:text-blue-300"
        >
          Retention limits this view to the most recent {displayRange} days.
        </div>
      )}

      <section aria-labelledby="analytics-overview-heading" className="space-y-2">
        <h2
          id="analytics-overview-heading"
          className="px-0.5 text-sm font-semibold text-foreground"
        >
          Response overview
        </h2>
        <Card className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border-border bg-border shadow-none">
          <Link
            href="/m/incidents?filter=all_open"
            className="bg-card p-3.5 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="block text-xl font-bold tabular-nums text-foreground">
              {metrics.activeIncidents}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Active now</span>
          </Link>
          <div className="bg-card p-3.5">
            <span className="block text-xl font-bold tabular-nums text-foreground">
              {metrics.totalIncidents}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              New in {displayRange}d
            </span>
          </div>
          <div className="bg-card p-3.5">
            <span className="block text-xl font-bold tabular-nums text-foreground">
              {formatDuration(metrics.mttd)}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">MTTA</span>
          </div>
          <div className="bg-card p-3.5">
            <span className="block text-xl font-bold tabular-nums text-foreground">
              {formatDuration(metrics.mttr)}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">MTTR</span>
          </div>
        </Card>
      </section>

      <section aria-labelledby="analytics-sla-heading" className="space-y-2">
        <h2 id="analytics-sla-heading" className="px-0.5 text-sm font-semibold text-foreground">
          SLA compliance
        </h2>
        <Card className="space-y-4 rounded-xl border-border bg-card p-3.5 shadow-none">
          <div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-foreground">Acknowledge</span>
              <span className="font-bold tabular-nums text-foreground">
                {formatPercent(metrics.ackCompliance)}
              </span>
            </div>
            <ProgressLine value={metrics.ackCompliance ?? 0} tone="blue" />
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {metrics.ackBreaches} breaches
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-foreground">Resolve</span>
              <span className="font-bold tabular-nums text-foreground">
                {formatPercent(metrics.resolveCompliance)}
              </span>
            </div>
            <ProgressLine value={metrics.resolveCompliance ?? 0} tone="emerald" />
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {metrics.resolveBreaches} breaches
            </p>
          </div>
        </Card>
      </section>

      <section aria-labelledby="analytics-trend-heading" className="space-y-2">
        <h2 id="analytics-trend-heading" className="px-0.5 text-sm font-semibold text-foreground">
          Incident trend
        </h2>
        <Card className="space-y-3 rounded-xl border-border bg-card p-3.5 shadow-none">
          {trendSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No incidents opened in this period, so there is no trend yet.
            </p>
          ) : (
            trendSeries.map(point => (
              <div key={point.key}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{point.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{point.count}</span>
                </div>
                <ProgressLine value={(point.count / trendMax) * 100} />
              </div>
            ))
          )}
        </Card>
      </section>

      <section aria-labelledby="analytics-breakdown-heading" className="space-y-2">
        <h2
          id="analytics-breakdown-heading"
          className="px-0.5 text-sm font-semibold text-foreground"
        >
          Breakdown
        </h2>
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          <details open className="group border-b border-border/70">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-sm px-3.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Urgency
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {metrics.totalIncidents} incidents
              </span>
            </summary>
            <div className="grid grid-cols-3 border-t border-border/70 bg-muted/15">
              {[
                ['High', metrics.highUrgencyCount, 'text-status-critical-deep dark:text-rose-300'],
                [
                  'Medium',
                  metrics.mediumUrgencyCount,
                  'text-status-elevated-deep dark:text-amber-300',
                ],
                ['Low', metrics.lowUrgencyCount, 'text-status-info-deep dark:text-blue-300'],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="px-2 py-3 text-center">
                  <strong className={`block text-base font-bold tabular-nums ${tone}`}>
                    {String(value)}
                  </strong>
                  <span className="text-xs text-muted-foreground">{String(label)}</span>
                </div>
              ))}
            </div>
          </details>

          <details className="group border-b border-border/70">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-sm px-3.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Services
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                Top {topServices.length}
              </span>
            </summary>
            <div className="space-y-2 border-t border-border/70 px-3.5 py-3">
              {topServices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No incidents by service in this period.
                </p>
              ) : (
                topServices.map(service => (
                  <div key={service.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{service.name}</span>
                    <strong className="tabular-nums text-foreground">{service.count}</strong>
                  </div>
                ))
              )}
            </div>
          </details>

          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-sm px-3.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Responders
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                Active load
              </span>
            </summary>
            <div className="space-y-2 border-t border-border/70 px-3.5 py-3">
              {assigneeLoad.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No assigned incidents in this period.
                </p>
              ) : (
                assigneeLoad.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{item.name}</span>
                    <strong className="tabular-nums text-foreground">{item.count}</strong>
                  </div>
                ))
              )}
            </div>
          </details>
        </Card>
      </section>

      <MobileSection
        id="analytics-recent"
        title="Recent incidents"
        action={
          <Link href="/m/incidents" className={mobileSectionLinkClass}>
            View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        {recentIncidents.length === 0 ? (
          <EmptyState
            icon={<BarChart3 aria-hidden="true" />}
            title="No incidents in this period"
            description="Pick a longer range to compare response times across more incidents."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {recentIncidents.map(incident => (
              <MobileIncidentRow
                key={incident.id}
                incident={{ ...incident, serviceName: incident.service.name }}
              />
            ))}
          </MobileListCard>
        )}
      </MobileSection>

      <p className="flex items-center gap-1.5 px-0.5 text-xs leading-relaxed text-muted-foreground">
        <Activity className="h-3 w-3 shrink-0" aria-hidden="true" />
        Metrics cover the selected authorized window and respect retention limits.
      </p>
    </div>
  );
}
