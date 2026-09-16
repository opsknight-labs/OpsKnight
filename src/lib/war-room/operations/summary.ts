import type { IntegrationHealthSummary, OperationalHealth } from './types';
import type { WarRoomOperationalSnapshot } from './types';

export function summarizeOperationalHealth(
  snapshots: readonly WarRoomOperationalSnapshot[]
): IntegrationHealthSummary[] {
  const byProvider = new Map<string, IntegrationHealthSummary>();
  for (const s of snapshots) {
    const key = s.provider;
    if (!byProvider.has(key)) {
      byProvider.set(key, {
        provider: key as IntegrationHealthSummary['provider'],
        operationalHealth: 'HEALTHY',
        healthyRooms: 0,
        degradedRooms: 0,
        driftedRooms: 0,
        unavailableRooms: 0,
        unknownRooms: 0,
        totalRooms: 0,
        externalCleanupPending: 0,
      });
    }
    const summary = byProvider.get(key)!;
    summary.totalRooms++;
    if (s.externalCleanupPending) summary.externalCleanupPending++;
    switch (s.operationalHealth as OperationalHealth) {
      case 'HEALTHY':
        summary.healthyRooms++;
        break;
      case 'DEGRADED':
        summary.degradedRooms++;
        break;
      case 'DRIFTED':
        summary.driftedRooms++;
        break;
      case 'UNAVAILABLE':
        summary.unavailableRooms++;
        break;
      case 'UNKNOWN':
        summary.unknownRooms++;
        break;
    }
  }
  // Roll up overall health per provider: worst wins
  for (const summary of byProvider.values()) {
    if (summary.unknownRooms > 0) summary.operationalHealth = 'UNKNOWN';
    else if (summary.unavailableRooms > 0) summary.operationalHealth = 'UNAVAILABLE';
    else if (summary.driftedRooms > 0) summary.operationalHealth = 'DRIFTED';
    else if (summary.degradedRooms > 0) summary.operationalHealth = 'DEGRADED';
    else summary.operationalHealth = 'HEALTHY';
  }
  return [...byProvider.values()];
}
