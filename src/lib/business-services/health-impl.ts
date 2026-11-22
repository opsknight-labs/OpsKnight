import type { BusinessServiceEngine } from './contract';
import { canSeeBusinessService, getHealthSnapshot } from './health';

async function getBusinessServiceHealth(
  ...[ids, actor]: Parameters<BusinessServiceEngine['getBusinessServiceHealth']>
) {
  const { businessServiceReadScope } = await import('./commands');
  const scope = businessServiceReadScope(actor);
  const snapshot = await getHealthSnapshot({ requireIds: ids });
  const result = new Map<string, NonNullable<ReturnType<typeof snapshot.health.get>>>();
  for (const id of ids) {
    const service = snapshot.byId.get(id);
    const health = snapshot.health.get(id);
    if (service && health && canSeeBusinessService(service, scope)) result.set(id, health);
  }
  return result;
}

export const engine: BusinessServiceEngine = {
  getBusinessServiceHealth,
  listBusinessServices: async (params, actor) =>
    (await import('./stats')).listBusinessServices(params, actor),
  getImpactTimeline: async (id, window, actor) =>
    (await import('./stats')).getImpactTimeline(id, window, actor),
  getBusinessServiceStats: async (id, window, actor) =>
    (await import('./stats')).getBusinessServiceStats(id, window, actor),
  setIncidentImpact: async (input, actor) => {
    await (await import('./impacts')).setIncidentImpactCommand(input, actor);
  },
  wouldCreateSupportCycle: async (parentId, childId) =>
    (await import('./stats')).wouldCreateSupportCycle(parentId, childId),
};
