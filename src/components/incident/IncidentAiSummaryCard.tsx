import Link from 'next/link';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getAiSettings } from '@/lib/intelligence/ai/settings';
import IncidentAiSummary from '@/components/incident/IncidentAiSummary';

type Availability = { enabled: boolean; canPostNote: boolean; canManage: boolean };

async function availability(): Promise<Availability> {
  try {
    const actor = await getCurrentAuthorizationActor();
    const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ))
      return { enabled: false, canPostNote: false, canManage };
    return {
      enabled: (await getAiSettings()).enabled,
      // The note composer's permission (assertCanAddIncidentNote); the action re-checks it.
      canPostNote:
        actor.status === 'ACTIVE' && hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE),
      canManage,
    };
  } catch (error) {
    logger.debug('[Intelligence] AI summary not shown', {
      error: error instanceof Error ? error.name : 'error',
    });
    return { enabled: false, canPostNote: false, canManage: false };
  }
}

/** Shown only while AI is enabled. Renders nothing on any failure. */
export default async function IncidentAiSummaryCard({ incidentId }: { incidentId: string }) {
  const { enabled, canPostNote, canManage } = await availability();
  if (enabled) return <IncidentAiSummary incidentId={incidentId} canPostNote={canPostNote} />;
  return (
    <p className="p-4 text-sm text-muted-foreground">
      AI summaries are unavailable.{' '}
      {canManage ? (
        <>
          Configure an AI provider in{' '}
          <Link href="/settings/intelligence/ai" className="underline underline-offset-2">
            Intelligence settings
          </Link>{' '}
          to turn them on.
        </>
      ) : (
        'An administrator can turn them on.'
      )}
    </p>
  );
}
