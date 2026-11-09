import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { BookOpen, Compass, GitCommitHorizontal, History } from 'lucide-react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getSimilarIncidentsForActor } from '@/lib/intelligence/similarity/view';
import { getResponseIntelligenceForActor } from '@/lib/intelligence/response/view';
import { getTriageForActor } from '@/lib/intelligence/triage/view';
import TriageChips from '../TriageChips';

/**
 * Intelligence on the mobile incident page: triage chips, similar incidents, possible causes and
 * runbooks as small server-rendered sections. No tabs and no client bundle beyond the triage chips;
 * each section streams on its own, shows only what the viewer may read (the view functions apply the
 * incident, service and runbook read scopes) and renders nothing when empty or on any failure.
 */

const MOBILE_LIMIT = 3;

const formatDate = (date: Date) => date.toISOString().slice(0, 10);
const formatLead = (minutes: number) =>
  minutes < 1
    ? 'moments before'
    : minutes < 90
      ? `${minutes} min before`
      : `${Math.round(minutes / 60)} h before`;

function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="space-y-1.5 border-t border-border/70 pt-2.5 first:border-t-0 first:pt-0"
    >
      <h3 id={id} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function SectionSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={`Loading ${label}`} className="space-y-1.5 py-1">
      <Skeleton className="h-3 w-1/2 motion-reduce:animate-none" />
      <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
    </div>
  );
}

/** Runs a scoped read for the viewer; any failure is logged and treated as "nothing to show". */
async function load<T>(
  incidentId: string,
  part: string,
  read: (actor: Awaited<ReturnType<typeof getCurrentAuthorizationActor>>) => Promise<T | null>
): Promise<T | null> {
  try {
    return await read(await getCurrentAuthorizationActor());
  } catch (error) {
    logger.warn(`[Intelligence] Mobile ${part} unavailable`, {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function MobileTriageSection({ incidentId }: { incidentId: string }) {
  const view = await load(incidentId, 'triage', actor => getTriageForActor(incidentId, actor));
  if (!view || view.suggestions.length === 0) return null;
  return (
    <Section
      id="mobile-triage-heading"
      icon={<Compass className="h-3.5 w-3.5" aria-hidden="true" />}
      title="Triage suggestions"
    >
      <TriageChips incidentId={incidentId} suggestions={view.suggestions} canAct={view.canAct} />
    </Section>
  );
}

export async function MobileSimilarSection({ incidentId }: { incidentId: string }) {
  const similar = await load(incidentId, 'similar incidents', actor =>
    getSimilarIncidentsForActor(incidentId, actor)
  );
  if (!similar || similar.length === 0) return null;
  return (
    <Section
      id="mobile-similar-heading"
      icon={<History className="h-3.5 w-3.5" aria-hidden="true" />}
      title="Similar past incidents"
    >
      <ul className="divide-y divide-border/70">
        {similar.slice(0, MOBILE_LIMIT).map(item => (
          <li key={item.incidentId}>
            <Link
              href={`/m/incidents/${item.incidentId}`}
              className="block min-h-11 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-sm font-medium text-foreground">{item.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {item.serviceName} · {formatDate(item.createdAt)} · {item.status.toLowerCase()} ·
                match {item.matchPercent}%
              </span>
              {item.resolutionSummary && (
                <span className="mt-0.5 block text-[11px] text-foreground/80">
                  Fixed by: {item.resolutionSummary}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export async function MobileResponseSection({ incidentId }: { incidentId: string }) {
  const view = await load(incidentId, 'causes and runbooks', actor =>
    getResponseIntelligenceForActor(incidentId, actor)
  );
  if (!view) return null;
  const changes = view.changes.slice(0, MOBILE_LIMIT);
  const runbooks = view.runbooks.slice(0, MOBILE_LIMIT);
  if (changes.length === 0 && runbooks.length === 0) return null;
  return (
    <>
      {changes.length > 0 && (
        <Section
          id="mobile-causes-heading"
          icon={<GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
          title="Possible causes"
        >
          <p className="text-[11px] text-muted-foreground">
            Leads from timing and dependencies, not confirmed causes.
          </p>
          <ul className="divide-y divide-border/70">
            {changes.map(change => (
              <li key={change.findingId} className="py-2">
                {change.url ? (
                  <a
                    href={change.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {change.summary}
                  </a>
                ) : (
                  <p className="text-sm font-medium">{change.summary}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {change.kind.replace('_', ' ').toLowerCase()} · {formatLead(change.leadMinutes)}{' '}
                  onset{change.serviceName ? ` · ${change.serviceName}` : ''}
                  {change.riskPercent !== null ? ` · risk ${change.riskPercent}%` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {runbooks.length > 0 && (
        <Section
          id="mobile-runbooks-heading"
          icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
          title="Runbooks that have worked here"
        >
          <ul className="divide-y divide-border/70">
            {runbooks.map(item => (
              <li key={item.findingId}>
                <Link
                  href={`/runbooks/${item.runbookId}`}
                  className="block min-h-11 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-sm font-medium text-foreground">{item.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {item.eligible > 0
                      ? `Succeeded ${item.succeeded} of ${item.eligible} runs on this service`
                      : 'Attached to this service, not run yet'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** Shown instead of the sections when intelligence is off for the service, to managers only. */
async function MobileIntelligenceOff() {
  const canManage = await load('-', 'settings note', async actor =>
    hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE)
  );
  if (!canManage) return null;
  return (
    <section
      aria-labelledby="mobile-intelligence-off-heading"
      className="rounded-xl border border-dashed border-border bg-card p-3.5"
    >
      <h2 id="mobile-intelligence-off-heading" className="text-xs font-semibold">
        Intelligence is off for this service
      </h2>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Turn it on in Settings › Intelligence to see similar incidents, likely causes, runbooks and
        triage suggestions here. Only intelligence managers see this note.
      </p>
      <Link
        href="/settings/intelligence"
        className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-primary underline-offset-2 hover:underline"
      >
        Open intelligence settings
      </Link>
    </section>
  );
}

export default function MobileIncidentIntelligence({
  incidentId,
  enabled,
}: {
  incidentId: string;
  /** Intelligence is on for the incident's service and the viewer may read suggestions. */
  enabled: boolean;
}) {
  if (!enabled)
    return (
      <Suspense fallback={null}>
        <MobileIntelligenceOff />
      </Suspense>
    );
  return (
    <section
      aria-labelledby="mobile-intelligence-heading"
      className="space-y-2.5 rounded-xl border border-border bg-card p-3.5"
      data-testid="mobile-intelligence"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2">
        <h2 id="mobile-intelligence-heading" className="text-xs font-semibold">
          Intelligence
        </h2>
        <Link
          href={`/incidents/${incidentId}`}
          className="inline-flex min-h-11 items-center text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
        >
          Full analysis
        </Link>
      </div>
      <Suspense fallback={null}>
        <MobileTriageSection incidentId={incidentId} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton label="similar incidents" />}>
        <MobileSimilarSection incidentId={incidentId} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton label="causes and runbooks" />}>
        <MobileResponseSection incidentId={incidentId} />
      </Suspense>
      <p className="text-[11px] text-muted-foreground">
        Hints from past incidents. They never change routing or notifications.
      </p>
    </section>
  );
}
