import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import AskSquirePanel from '@/components/squire/AskSquirePanel';

async function loadStatus() {
  try {
    const actor = await getCurrentAuthorizationActor();
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ))
      return 'forbidden' as const;
    const status = await getAiPublicStatus();
    return status.squireEnabled ? status : null;
  } catch (error) {
    logger.debug('[Squire] Incident panel not shown', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Incident-page entry point. Renders nothing while the assistant is off or on any failure. */
export default async function IncidentAskSquireCard() {
  const status = await loadStatus();
  if (status === 'forbidden')
    return (
      <p className="p-4 text-sm text-muted-foreground">
        You do not have permission to use the assistant.
      </p>
    );
  return status ? (
    <AskSquirePanel name={status.squireName} avatar={status.squireAvatar} />
  ) : (
    <p className="p-4 text-sm text-muted-foreground">
      Squire is disabled. An administrator can enable the assistant in Intelligence settings.
    </p>
  );
}
