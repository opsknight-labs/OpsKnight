import Link from 'next/link';
import { GitCommitHorizontal, BookOpen } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getResponseIntelligenceForActor } from '@/lib/intelligence/response/view';

const RELATION_LABEL = {
  SAME_SERVICE: 'Same service',
  UPSTREAM: 'Upstream dependency',
  GLOBAL: 'Not tied to a service',
} as const;

const formatLead = (minutes: number) =>
  minutes < 1 ? 'moments before' : minutes < 90 ? `${minutes} min before` : `${Math.round(minutes / 60)} h before`;

/**
 * Likely contributing changes and proven runbooks. These are hypotheses to verify, not conclusions,
 * and the card says so. Renders nothing unless there is something the viewer may see, and nothing at
 * all on any failure: it is advisory and must never affect the incident page.
 */
export default async function IncidentResponseCard({ incidentId }: { incidentId: string }) {
  let view;
  try {
    const actor = await getCurrentAuthorizationActor();
    view = await getResponseIntelligenceForActor(incidentId, actor);
  } catch (error) {
    logger.warn('[Intelligence] Response intelligence unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!view) return null;

  return (
    <section aria-labelledby="response-intelligence-heading" className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="response-intelligence-heading" className="text-sm font-semibold">
            Possible causes
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Based on timing and service dependencies. These are leads to verify, not confirmed causes.
        </p>
      </div>

      {view.changes.length > 0 && (
        <ul className="divide-y divide-border">
          {view.changes.map(change => (
            <li key={change.findingId} className="space-y-1 py-2">
              <p className="text-sm font-medium">
                {change.url ? (
                  <a href={change.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {change.summary}
                  </a>
                ) : (
                  change.summary
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {change.kind.replace('_', ' ').toLowerCase()} · {formatLead(change.leadMinutes)} onset ·{' '}
                {RELATION_LABEL[change.relation]}
                {change.serviceName ? ` (${change.serviceName})` : ''} · {change.source}
                {change.version ? ` · ${change.version}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {view.upstreamIncidents.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upstream incidents</h3>
          <ul className="divide-y divide-border">
            {view.upstreamIncidents.map(item => (
              <li key={item.findingId} className="py-2">
                <Link href={`/incidents/${item.incidentId}`} className="text-sm font-medium hover:underline">
                  {item.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.serviceName} · {formatLead(item.leadMinutes)} this one · {item.status.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.runbooks.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Runbooks that have worked here</h3>
          </div>
          <ul className="divide-y divide-border">
            {view.runbooks.map(item => (
              <li key={item.findingId} className="py-2">
                <Link href={`/runbooks/${item.runbookId}`} className="text-sm font-medium hover:underline">
                  {item.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.eligible > 0
                    ? `Succeeded ${item.succeeded} of ${item.eligible} completed runs on this service`
                    : 'Attached to this service, not run yet'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
