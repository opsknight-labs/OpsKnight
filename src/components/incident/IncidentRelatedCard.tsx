import IntelligenceEmptyState from './IntelligenceEmptyState';
import Link from 'next/link';
import { Link2 } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getRelatedIncidentsForActor } from '@/lib/intelligence/correlation/view';
import RelatedIncidentActions from '@/components/incident/RelatedIncidentActions';

/**
 * Incidents related to this one, by rule suggestion or by a person. Renders nothing unless there is
 * something the viewer may see, and nothing at all on any failure: it is advisory and must never
 * affect the incident page.
 */
export default async function IncidentRelatedCard({ incidentId }: { incidentId: string }) {
  let related;
  let canDecide = false;
  try {
    const actor = await getCurrentAuthorizationActor();
    canDecide = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK);
    related = await getRelatedIncidentsForActor(incidentId, actor);
  } catch (error) {
    logger.warn('[Intelligence] Related incidents unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!related) return <IntelligenceEmptyState incidentId={incidentId} />;

  return (
    <section
      aria-labelledby="related-incidents-heading"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="related-incidents-heading" className="text-sm font-semibold">
          Related incidents
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {related.map(item => (
          <li
            key={item.relationshipId}
            className="flex flex-wrap items-start justify-between gap-2 py-2"
          >
            <div className="min-w-0 space-y-1">
              <Link
                href={`/incidents/${item.incidentId}`}
                className="text-sm font-medium hover:underline"
              >
                {item.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {item.serviceName} · {item.createdAt.toISOString().slice(0, 10)} ·{' '}
                {item.status.toLowerCase()}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.automatic
                  ? 'Automatically grouped after paging'
                  : item.origin === 'HUMAN'
                    ? 'Linked by a responder'
                    : item.ruleId
                      ? `Suggested by grouping rule “${item.ruleId}”`
                      : 'Suggested by a grouping rule'}
                {item.decision === 'ACCEPTED' ? ' · confirmed' : ''}
              </p>
            </div>
            {canDecide && (
              <RelatedIncidentActions
                incidentId={incidentId}
                relationshipId={item.relationshipId}
                decision={item.decision}
                automatic={item.automatic}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Links are suggestions for responders. They never merge incidents or change routing, and each
        can be undone.
      </p>
    </section>
  );
}
