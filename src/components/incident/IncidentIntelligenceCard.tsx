import Link from 'next/link';
import { History } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getSimilarIncidentsForActor } from '@/lib/intelligence/similarity/view';

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Suggested precedents for an incident. Renders nothing unless intelligence is on for this service,
 * the viewer may read it, and there is something to show. Any failure also renders nothing: this card
 * is advisory and must never affect the incident page.
 */
export default async function IncidentIntelligenceCard({ incidentId }: { incidentId: string }) {
  let similar;
  try {
    const actor = await getCurrentAuthorizationActor();
    similar = await getSimilarIncidentsForActor(incidentId, actor);
  } catch (error) {
    logger.warn('[Intelligence] Similar incidents unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!similar) return null;

  return (
    <section
      aria-labelledby="similar-incidents-heading"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="similar-incidents-heading" className="text-sm font-semibold">
          Similar past incidents
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {similar.map(item => (
          <li key={item.incidentId} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0 space-y-1">
              <Link href={`/incidents/${item.incidentId}`} className="text-sm font-medium hover:underline">
                {item.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {item.serviceName} · {formatDate(item.createdAt)} · {item.status.toLowerCase()}
              </p>
              <ul className="flex flex-wrap gap-1" aria-label="Why this matched">
                {item.reasons.map(reason => (
                  <li key={reason} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
            <span
              className="text-xs tabular-nums text-muted-foreground"
              title="A ranking signal for ordering suggestions, not a probability"
            >
              Match {item.matchPercent}%
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Suggestions are based on past incident wording and context. They are hints for responders and
        never change routing or notifications.
      </p>
    </section>
  );
}
