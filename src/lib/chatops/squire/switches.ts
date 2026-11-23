import 'server-only';
import { getBaseUrl } from '@/lib/env-validation';
import { getAiSettings } from '@/lib/intelligence/ai/settings';

/**
 * Light helpers shared by the chat handler and by channel publishing. Kept apart from handler.ts so the
 * intelligence lane (which publishes proactive updates) never loads the assistant's chat turn.
 */

export function chatBaseUrl(): string {
  try {
    return getBaseUrl().replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

/** Both switches: the assistant itself and its chat surface. Fails closed. */
export async function isSquireChatOpsEnabled(): Promise<boolean> {
  try {
    const settings = await getAiSettings();
    return settings.squireEnabled && settings.squireChatOpsEnabled;
  } catch {
    return false;
  }
}
