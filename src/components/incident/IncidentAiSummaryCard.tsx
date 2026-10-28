import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getAiSettings } from '@/lib/intelligence/ai/settings';
import IncidentAiSummary from '@/components/incident/IncidentAiSummary';

async function available(): Promise<boolean> {
  try {
    const actor = await getCurrentAuthorizationActor();
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return false;
    return (await getAiSettings()).enabled;
  } catch (error) {
    logger.debug('[Intelligence] AI summary not shown', { error: error instanceof Error ? error.name : 'error' });
    return false;
  }
}

/** Shown only while AI is enabled. Renders nothing on any failure. */
export default async function IncidentAiSummaryCard({ incidentId }: { incidentId: string }) {
  return (await available()) ? <IncidentAiSummary incidentId={incidentId} /> : null;
}
