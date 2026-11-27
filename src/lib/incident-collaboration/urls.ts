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
  const { channelUrl, channelId, tenantId } = options;

  if (provider === 'SLACK') {
    // Slack's app scheme needs both the workspace and the channel: without `team` the desktop app
    // opens but cannot find the channel. With no workspace known, the web redirect is the safe link.
    if (channelId && tenantId) {
      return `slack://channel?team=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(channelId)}`;
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
