import { Compass } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getTriageForActor } from '@/lib/intelligence/triage/view';
import TriageChips from './TriageChips';

/**
 * Triage suggestions: urgency, owner, probable duplicate and expected time to resolve, derived from
 * how similar incidents were handled. Accepting one runs the incident's normal command; nothing is
 * applied on its own. Renders nothing unless there is a suggestion the viewer may see, and nothing at
 * all on any failure.
 */
export default async function IncidentTriageCard({ incidentId }: { incidentId: string }) {
  let view;
  try {
    view = await getTriageForActor(incidentId, await getCurrentAuthorizationActor());
  } catch (error) {
    logger.warn('[Intelligence] Triage suggestions unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!view) return null;
  return (
    <section
      aria-labelledby="triage-suggestions-heading"
      className="space-y-2 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Compass className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="triage-suggestions-heading" className="text-sm font-semibold">
          Triage suggestions
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">
        From how similar incidents were handled. Apply what fits; nothing changes on its own.
      </p>
      <TriageChips incidentId={incidentId} suggestions={view.suggestions} canAct={view.canAct} />
    </section>
  );
}
