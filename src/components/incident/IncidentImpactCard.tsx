import Link from 'next/link';
import { Network } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  getIncidentImpactForActor,
  isImpactEmpty,
  type IncidentImpactView,
} from '@/lib/intelligence/impact/view';

const SERVICE_STATUS = new Map<string, { label: string; className: string }>(
  Object.entries({
    OPERATIONAL: { label: 'Operational', className: 'bg-status-ok-soft text-status-ok-deep' },
    DEGRADED: { label: 'Degraded', className: 'bg-status-elevated-soft text-status-elevated-deep' },
    PARTIAL_OUTAGE: {
      label: 'Partial outage',
      className: 'bg-status-elevated-soft text-status-elevated-deep',
    },
    MAJOR_OUTAGE: {
      label: 'Major outage',
      className: 'bg-status-critical-soft text-status-critical-deep',
    },
    MAINTENANCE: { label: 'Maintenance', className: 'bg-status-info-soft text-status-info-deep' },
  })
);

const BURN_LABEL = { critical: 'Burning fast', warning: 'Burning', none: 'Within budget' };
const BURN_CLASS = {
  critical: 'text-status-critical',
  warning: 'text-status-elevated',
  none: 'text-muted-foreground',
};

function StatusPill({ status }: { status: string }) {
  const tone = SERVICE_STATUS.get(status) ?? { label: status, className: 'bg-muted' };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.className}`}>
      {tone.label}
    </span>
  );
}

/** Presentational part, separate so it can be rendered and tested without data access. */
export function ImpactCardBody({ view }: { view: IncidentImpactView }) {
  if (isImpactEmpty(view))
    return (
      <EmptyState
        variant="simple"
        size="sm"
        icon={<Network aria-hidden="true" />}
        title="No wider impact found"
        description={
          view.slo.state === 'RESTRICTED'
            ? 'No dependent services or status-page components you can see. SLO budget needs global metrics access.'
            : 'No dependent services, status-page components or availability objectives are linked to this service.'
        }
      />
    );
  return (
    <section
      aria-labelledby="incident-impact-heading"
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="incident-impact-heading" className="text-sm font-semibold">
            Estimated impact
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          From the active dependency graph, linked status-page components and the service&apos;s
          availability objectives. An estimate to check, not a measurement.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Dependent services ({view.downstream.length}
          {view.downstreamTruncated ? '+' : ''})
        </h3>
        {view.downstream.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No services you can see depend on this one.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Dependent services">
            {view.downstream.map(service => (
              <li key={service.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/services/${service.id}`} className="font-medium hover:underline">
                  {service.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {service.distance === 1 ? 'direct' : `${service.distance} hops`}
                </span>
                <StatusPill status={service.status} />
                {service.openIncidents > 0 && (
                  <span className="text-xs text-status-critical">
                    {service.openIncidents} open{' '}
                    {service.openIncidents === 1 ? 'incident' : 'incidents'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {view.components.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status-page components
          </h3>
          <ul className="space-y-1" aria-label="Status-page components">
            {view.components.map(component => (
              <li
                key={`${component.statusPageId}:${component.serviceId}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="font-medium">{component.componentName}</span>
                <span className="text-xs text-muted-foreground">
                  on {component.statusPageName}
                  {component.pageEnabled ? '' : ' (page not published)'}
                  {component.direct ? '' : ' · dependent'}
                </span>
                <StatusPill status={component.status} />
              </li>
            ))}
          </ul>
          {view.componentsTruncated && (
            <p className="text-xs text-muted-foreground">Showing the first 25 components.</p>
          )}
        </div>
      )}

      {view.slo.state === 'AVAILABLE' && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Error budget at risk
          </h3>
          <ul className="space-y-1" aria-label="Error budget at risk">
            {view.slo.objectives.map(objective => (
              <li key={objective.name} className="text-sm">
                <span className="font-medium">{objective.name}</span>{' '}
                <span className="text-xs text-muted-foreground">({objective.targetPercent}%)</span>{' '}
                <span className={`text-xs ${BURN_CLASS[objective.severity]}`}>
                  {BURN_LABEL[objective.severity]} · {objective.fastBurn}× over 1 h,{' '}
                  {objective.slowBurn}× over 6 h
                </span>
                {objective.incidentBudgetPercent !== null && (
                  <p className="text-xs text-muted-foreground">
                    This incident has used about {objective.incidentBudgetPercent}% of the
                    window&apos;s error budget.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.slo.state === 'UNAVAILABLE' && (
        <p className="text-xs text-muted-foreground">SLO burn is unavailable right now.</p>
      )}
    </section>
  );
}

/**
 * Impact estimate for the incident page. A server component rendered lazily under Suspense; read-only, and
 * renders nothing at all on any failure so it can never break the incident page.
 */
export default async function IncidentImpactCard({ incidentId }: { incidentId: string }) {
  let view;
  try {
    view = await getIncidentImpactForActor(incidentId, await getCurrentAuthorizationActor());
  } catch (error) {
    logger.warn('[Intelligence] Incident impact unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!view) return null;
  return <ImpactCardBody view={view} />;
}
