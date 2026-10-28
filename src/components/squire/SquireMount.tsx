import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import SquireLauncher from '@/components/squire/SquireLauncher';

async function loadStatus() {
  try {
    const actor = await getCurrentAuthorizationActor();
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
    const status = await getAiPublicStatus();
    return status.squireEnabled ? status : null;
  } catch (error) {
    logger.debug('[Squire] Not mounted', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Mounts the assistant only for people who may use it and only while an administrator has turned it
 * on, so when it is off no assistant code is sent to the browser. Fails closed and silent: the
 * assistant is optional and must never affect the page it sits on.
 */
export default async function SquireMount() {
  const status = await loadStatus();
  if (!status) return null;
  return (
    <SquireLauncher
      name={status.squireName}
      avatar={status.squireAvatar}
      launcher={status.squireLauncher}
      animated={status.squireAnimations}
    />
  );
}
