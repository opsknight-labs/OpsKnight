import { Clock } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getIncidentTimeAxisForActor } from '@/lib/intelligence/timeline/service';
import IntelligenceEmptyState from './IntelligenceEmptyState';
import IncidentTimeAxisList from './intelligence/IncidentTimeAxisList';

/**
 * One time axis for the incident: its alerts, changes on it and its upstream services, upstream incidents,
 * noise decisions (with why, and the reversal for those who may reverse), grouping and people's decisions
 * on suggestions, each relative to onset. Renders nothing at all on any failure.
 */
export default async function IncidentTimeAxisCard({ incidentId }: { incidentId: string }) {
  let axis;
  try {
    axis = await getIncidentTimeAxisForActor(incidentId, await getCurrentAuthorizationActor());
  } catch (error) {
    logger.warn('[Intelligence] Incident time axis unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!axis || axis.entries.length <= 1) return <IntelligenceEmptyState incidentId={incidentId} />;
  return (
    <section
      aria-labelledby="incident-time-axis-heading"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="incident-time-axis-heading" className="text-sm font-semibold">
            What happened around this incident
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Alerts, changes, upstream incidents, noise decisions and suggestion decisions on one
          timeline, relative to when the incident opened.
          {axis.truncated ? ' Showing the first 50 of each kind.' : ''}
        </p>
      </div>
      <IncidentTimeAxisList incidentId={incidentId} axis={axis} />
    </section>
  );
}
