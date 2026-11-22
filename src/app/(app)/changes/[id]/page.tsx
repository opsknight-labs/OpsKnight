import { logger } from '@/lib/logger';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GitCommitHorizontal, Siren } from 'lucide-react';
import { getCurrentAuthorizationActor, getCurrentUser } from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';
import { readChangeReference } from '@/lib/intelligence/squire/references';
import { requirePageAccess, redirectWithoutIncidentRead } from '@/lib/access/server';
import { getChangeFollowers, FOLLOW_WINDOW_MINUTES } from '@/lib/intelligence/changes/followers';
import { RiskMeter } from '@/components/intelligence/overview/ChangePanel';
import { ListChip, ListWhen } from '@/components/intelligence/lists/shared';
import { EmptyState, PageHeader } from '@/components/patterns';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const kindLabel = (kind: string) => kind.toLowerCase().replace(/_/g, ' ');

export default async function ChangeReferencePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess('/changes/[id]');
  await redirectWithoutIncidentRead();
  const timeZone = getUserTimeZone(await getCurrentUser());
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
  const followHours = FOLLOW_WINDOW_MINUTES / 60;

  return (
    <article className="mx-auto w-full max-w-5xl space-y-4 sm:space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Changes', href: '/changes' }, { label: change.summary }]}
        eyebrow="Recorded change"
        title={change.summary}
        icon={GitCommitHorizontal}
        badges={<ListChip>{kindLabel(change.kind)}</ListChip>}
        description="Timing is evidence to investigate; it does not establish that a change caused an incident."
        stats={[
          { label: 'Occurred', value: <ListWhen value={change.occurredAt} timeZone={timeZone} /> },
          { label: 'Source', value: change.source },
          {
            label: 'Service',
            value: change.service ? (
              <Link
                href={`/services/${change.service.id}`}
                className="underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {change.service.name}
              </Link>
            ) : (
              'No service'
            ),
          },
          {
            label: 'Followed by',
            value: followers
              ? `${followers.incidents.length} ${followers.incidents.length === 1 ? 'incident' : 'incidents'}`
              : '—',
            subtext: followers ? `Within ${followHours} hours` : 'Follow-up tracking is off',
          },
        ]}
      />

      {followers && followers.riskScore !== null && (
        <section
          aria-labelledby="change-risk"
          className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          <header className="border-b border-border px-4 py-3 sm:px-5">
            <h2 id="change-risk" className="font-display text-base font-semibold tracking-tight">
              Risk
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A ranking signal from history, blast radius, timing and size, never a verdict.
            </p>
          </header>
          <div className="px-4 py-4 sm:px-5">
            <RiskMeter score={followers.riskScore} />
          </div>
        </section>
      )}

      {/* Absent while Intelligence or its ops helpers are off: no follow-up data is gathered then. */}
      {followers && (
        <section
          aria-labelledby="change-followers"
          className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          <header className="border-b border-border px-4 py-3 sm:px-5">
            <h2
              id="change-followers"
              className="font-display text-base font-semibold tracking-tight"
            >
              Incidents that followed this change
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opened within {followHours} hours on this service or a service that depends on it.
            </p>
          </header>
          {followers.incidents.length > 0 ? (
            <ul className="divide-y divide-border">
              {followers.incidents.map(incident => (
                <li key={incident.id} className="flex flex-wrap items-center gap-x-3 px-4 sm:px-5">
                  <Link
                    href={`/incidents/${incident.id}`}
                    className="flex min-h-11 min-w-0 flex-1 items-center break-words font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {incident.title}
                  </Link>
                  <span className="py-1 text-xs text-muted-foreground tabular-nums">
                    {incident.dependant ? `${incident.service.name} (depends on it) · ` : ''}
                    {incident.minutesAfter} min after · {incident.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              variant="simple"
              size="sm"
              icon={<Siren aria-hidden="true" />}
              title="No incidents followed this change"
              description={`Nothing opened within ${followHours} hours on this service or a service that depends on it.`}
              primaryAction={
                <Link
                  href="/changes"
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
                >
                  Back to changes
                </Link>
              }
            />
          )}
        </section>
      )}
    </article>
  );
}
