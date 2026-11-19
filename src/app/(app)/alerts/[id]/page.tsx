import { logger } from '@/lib/logger';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { readAlertReference } from '@/lib/intelligence/squire/references';
import { getListedAlert } from '@/lib/intelligence/lists/alerts';
import { ALERT_DECISION_LABELS } from '@/lib/intelligence/lists/contract';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AlertReferencePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess('/alerts/[id]');
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
  if (!alert && listed) {
    const decision = listed.decision;
    return (
      <article className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="break-words text-2xl font-semibold">{listed.summary}</h1>
        <p className="text-sm text-muted-foreground">
          Recorded alert · {listed.status.toLowerCase()}
          {listed.severity ? ` · ${listed.severity.toLowerCase()}` : ''} ·{' '}
          {listed.receivedAt.toISOString()}
        </p>
        {decision && (
          <p className="text-sm">
            {decision.applied ? 'Noise decision' : 'Shadow decision (not applied)'}:{' '}
            {ALERT_DECISION_LABELS[decision.kind].toLowerCase()}
            {decision.sourceName ? ` by ${decision.sourceName}` : ''}. {decision.reason}
          </p>
        )}
        <Link href={`/services/${listed.serviceId}`} className="text-sm underline">
          {listed.serviceName}
        </Link>
      </article>
    );
  }
  if (!alert) notFound();
  const noise = listed?.decision ?? null;
  return (
    <article className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="break-words text-2xl font-semibold">{alert.summary}</h1>
      <p className="text-sm text-muted-foreground">
        Recorded alert · {alert.status.toLowerCase()} · {alert.createdAt.toISOString()}
      </p>
      {noise && (
        <p className="text-sm">
          {noise.applied ? 'Noise decision' : 'Shadow decision (not applied)'}:{' '}
          {ALERT_DECISION_LABELS[noise.kind].toLowerCase()}
          {noise.sourceName ? ` by ${noise.sourceName}` : ''}. {noise.reason}
        </p>
      )}
      {alert.incidentId && (
        <Link href={`/incidents/${alert.incidentId}`} className="text-sm underline">
          Open incident
        </Link>
      )}
    </article>
  );
}
