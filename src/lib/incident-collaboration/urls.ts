/**
 * URL generation and deep-linking helpers for incident collaboration providers.
 */

import type { WarRoomProviderName } from './types';

/**
 * Derives a platform-native deep link URL if supported, or falls back to webUrl.
 */
export function getProviderDeepLinkUrl(
  provider: WarRoomProviderName,
  options: {
    channelUrl?: string | null;
    channelId?: string | null;
    tenantId?: string | null;
  }
): string | null {
  const { channelUrl, channelId } = options;

  if (provider === 'SLACK') {
    if (channelId) {
      return `slack://channel?id=${encodeURIComponent(channelId)}`;
    }
    return channelUrl || null;
  }

  if (provider === 'MICROSOFT_TEAMS') {
    if (channelUrl && channelUrl.startsWith('https://teams.microsoft.com/')) {
      // Teams desktop app URL protocol: msteams:/l/channel/...
      return channelUrl.replace(/^https:\/\/teams\.microsoft\.com\//, 'msteams:/');
    }
    return channelUrl || null;
  }

  return channelUrl || null;
}
