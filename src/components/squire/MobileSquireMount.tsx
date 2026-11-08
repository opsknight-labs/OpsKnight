import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import SquireLauncher from '@/components/squire/LazySquireLauncher';

async function loadStatus() {
  try {
    const actor = await getCurrentAuthorizationActor();
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
    const status = await getAiPublicStatus();
    return status.squireEnabled && status.mobileEnabled ? status : null;
  } catch (error) {
    logger.debug('[Squire] Not mounted on mobile', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The assistant on mobile incident pages: the same launcher, lazy-loaded and full screen, with the
 * page's incident as context (read from the URL, like on desktop). Mounted only when an administrator
 * has turned on both the assistant and its mobile surface; otherwise nothing is sent to the browser.
 */
export default async function MobileSquireMount() {
  const status = await loadStatus();
  if (!status) return null;
  return (
    <SquireLauncher
      name={status.squireName}
      avatar={status.squireAvatar}
      launcher="FLOATING"
      animated={status.squireAnimations}
      aiEnabled={status.aiEnabled}
      history={status.historyEnabled ? { retentionDays: status.historyRetentionDays } : null}
      fullscreen
    />
  );
}
