import { logger } from '@/lib/logger';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BellRing, ShieldOff } from 'lucide-react';
import { DecisionChip, SeverityChip } from '@/components/intelligence/lists/AlertsTable';
import { ListChip, ListWhen } from '@/components/intelligence/lists/shared';
import { EmptyState, PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { Button } from '@/components/ui/shadcn/button';
import { getCurrentAuthorizationActor, getCurrentUser } from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';
import { readAlertReference } from '@/lib/intelligence/squire/references';
import { getListedAlert, type AlertListDecision } from '@/lib/intelligence/lists/alerts';
import { ALERT_DECISION_LABELS } from '@/lib/intelligence/lists/contract';
import { requirePageAccess } from '@/lib/access/server';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** A titled card in the detail body, in the same anatomy as the overview cards. */
function DetailSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 id={id} className="font-display text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function NoiseDecision({ decision }: { decision: AlertListDecision | null }) {
  if (!decision)
    return (
      <EmptyState
        variant="simple"
        size="sm"
        icon={<ShieldOff aria-hidden="true" />}
        title="No noise decision"
        description="No noise control acted on this alert; it was handled as received."
      />
    );
  return (
    <div className="space-y-2 text-sm">
      <DecisionChip decision={decision} />
      <p>
        {decision.applied ? 'Noise decision' : 'Shadow decision (not applied)'}:{' '}
        {ALERT_DECISION_LABELS[decision.kind].toLowerCase()}
        {decision.sourceName ? ` by ${decision.sourceName}` : ''}. {decision.reason}
      </p>
    </div>
  );
}

const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase();

export default async function AlertReferencePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess('/alerts/[id]');
  const timeZone = getUserTimeZone(await getCurrentUser());
  const { id } = await params;
  let alert;
  let listed = null;
  try {
    const actor = await getCurrentAuthorizationActor();
    alert = await readAlertReference(actor, id);
    // The alerts list also shows alerts that never opened an incident (held back by a noise control);
    // those have no citation record, so they are read through the list's own scoped loader.
    listed = await getListedAlert(actor, id);
  } catch (error) {
    logger.error('[Intelligence] Alert source unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
  // A citation record (alert with an incident) wins for the title, status and time; the list row adds
  // the service, severity, labels and the noise decision.
  const { summary, status, receivedAt, incidentId } = alert
    ? {
        summary: alert.summary,
        status: alert.status,
        receivedAt: alert.createdAt,
        incidentId: alert.incidentId,
      }
    : listed
      ? {
          summary: listed.summary,
          status: listed.status,
          receivedAt: listed.receivedAt,
          incidentId: null,
        }
      : notFound();
  const decision = listed?.decision ?? null;

  return (
    <article className="mx-auto w-full max-w-5xl space-y-4 sm:space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Alerts', href: '/alerts' }, { label: summary }]}
        eyebrow="Recorded alert"
        title={summary}
        icon={BellRing}
        badges={
          <>
            <ListChip>{statusLabel(status)}</ListChip>
            {listed && <SeverityChip severity={listed.severity} />}
          </>
        }
        primaryAction={
          incidentId ? (
            <Button asChild size="sm" className={cn('h-11 sm:h-9', pageHeaderActionClass)}>
              <Link href={`/incidents/${incidentId}`}>Open incident</Link>
            </Button>
          ) : undefined
        }
        stats={[
          { label: 'Received', value: <ListWhen value={receivedAt} timeZone={timeZone} /> },
          { label: 'Status', value: statusLabel(status) },
          ...(listed
            ? [
                {
                  label: 'Service',
                  value: (
                    <Link
                      href={`/services/${listed.serviceId}`}
                      className="underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {listed.serviceName}
                    </Link>
                  ),
                },
                {
                  label: 'Noise decision',
                  value: decision
                    ? decision.applied
                      ? ALERT_DECISION_LABELS[decision.kind]
                      : `Shadow: ${ALERT_DECISION_LABELS[decision.kind].toLowerCase()}`
                    : 'None',
                },
              ]
            : []),
        ]}
      />

      {listed && (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
          <DetailSection
            id="alert-noise"
            title="Noise decision"
            description="What the noise controls did with this alert before anyone was paged."
          >
            <NoiseDecision decision={decision} />
          </DetailSection>
          <DetailSection
            id="alert-labels"
            title="Labels"
            description="Labels the integration sent with the alert."
          >
            {listed.labels.length > 0 ? (
              <ul aria-label="Labels" className="flex flex-wrap gap-1.5">
                {listed.labels.map(label => (
                  <li key={label.key} className="max-w-full">
                    <ListChip>
                      <span className="break-all">
                        {label.key}={label.value}
                      </span>
                    </ListChip>
                  </li>
                ))}
                {listed.moreLabels > 0 && (
                  <li className="text-xs text-muted-foreground">+{listed.moreLabels} more</li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">This alert carried no labels.</p>
            )}
          </DetailSection>
        </div>
      )}
    </article>
  );
}
