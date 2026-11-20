import { logger } from '@/lib/logger';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { readChangeReference } from '@/lib/intelligence/squire/references';
import { requirePageAccess } from '@/lib/access/server';
import { getChangeFollowers, FOLLOW_WINDOW_MINUTES } from '@/lib/intelligence/changes/followers';
import { RiskMeter } from '@/components/intelligence/overview/ChangePanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ChangeReferencePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess('/changes/[id]');
  const { id } = await params;
  const actor = await getCurrentAuthorizationActor();
  let change;
  try {
    change = await readChangeReference(actor, id);
  } catch (error) {
    logger.error('[Intelligence] Change source unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
  if (!change) notFound();
  const followers = await getChangeFollowers(actor, change.id);
  return (
    <article className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="break-words text-2xl font-semibold">{change.summary}</h1>
      <p className="text-sm text-muted-foreground">
        Recorded change · {change.kind.toLowerCase()} · {change.source} ·{' '}
        {change.occurredAt.toISOString()}
      </p>
      <p className="text-sm">
        Timing is evidence to investigate; it does not establish that a change caused an incident.
      </p>
      {change.service && (
        <Link href={`/services/${change.service.id}`} className="text-sm underline">
          {change.service.name}
        </Link>
      )}
      {followers && followers.riskScore !== null && <RiskMeter score={followers.riskScore} />}
      {followers && followers.incidents.length > 0 && (
        <section aria-labelledby="change-followers" className="space-y-2">
          <h2 id="change-followers" className="text-base font-medium">
            Incidents that followed this change
          </h2>
          <p className="text-xs text-muted-foreground">
            Opened within {FOLLOW_WINDOW_MINUTES / 60} hours on this service or a service that
            depends on it.
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {followers.incidents.map(incident => (
              <li key={incident.id} className="flex flex-wrap items-center gap-x-3 px-3">
                <Link
                  href={`/incidents/${incident.id}`}
                  className="flex min-h-11 min-w-0 flex-1 items-center break-words underline-offset-2 hover:underline"
                >
                  {incident.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {incident.dependant ? `${incident.service.name} (depends on it) · ` : ''}
                  {incident.minutesAfter} min after · {incident.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
