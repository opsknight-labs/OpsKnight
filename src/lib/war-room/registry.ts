import type { WarRoomProviderName } from './types';
import type { WarRoomProviderAdapter } from './provider';
import { microsoftTeamsWarRoomAdapter } from './providers/microsoft-teams/adapter';
import { slackWarRoomAdapter } from './providers/slack/adapter';

const providers = new Map<WarRoomProviderName, WarRoomProviderAdapter>([
  [microsoftTeamsWarRoomAdapter.provider, microsoftTeamsWarRoomAdapter],
  [slackWarRoomAdapter.provider, slackWarRoomAdapter],
]);

export function getWarRoomProvider(provider: WarRoomProviderName): WarRoomProviderAdapter {
  const adapter = providers.get(provider);
  if (!adapter) throw new Error(`War-room provider ${provider} is not registered.`);
  return adapter;
}

export function listWarRoomProviders(): readonly WarRoomProviderAdapter[] {
  return [...providers.values()];
}
