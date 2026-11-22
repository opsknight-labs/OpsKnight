/**
 * In-memory BusinessServiceEngine for tests and UI work before the real engine lands.
 * Ignores the actor: scope filtering is the real engine's job and is tested there.
 */
import type {
  BsStatus,
  BusinessServiceEngine,
  BusinessServiceHealth,
  BusinessServiceListItem,
  BusinessServiceStats,
  ImpactTimelineEntry,
  SetIncidentImpactInput,
} from '../contract';

export type FakeBusinessService = Omit<BusinessServiceListItem, 'health' | 'description'> & {
  description?: string | null;
  status?: BsStatus;
  health?: Partial<BusinessServiceHealth>;
};

export type FakeEngineSeed = {
  services?: FakeBusinessService[];
  /** [parentId, childId]: the child supports the parent. */
  supports?: [string, string][];
  timeline?: Record<string, ImpactTimelineEntry[]>;
  stats?: Record<string, Partial<BusinessServiceStats>>;
};

const EPOCH = new Date(0);

export function fakeHealth(
  businessServiceId: string,
  overrides: Partial<BusinessServiceHealth> = {}
): BusinessServiceHealth {
  return {
    businessServiceId,
    status: 'OPERATIONAL',
    since: null,
    reasons: [],
    openIncidentCount: 0,
    memberCount: 0,
    impactedMemberCount: 0,
    computedAt: EPOCH,
    ...overrides,
  };
}

export function createFakeBusinessServiceEngine(seed: FakeEngineSeed = {}) {
  const services = [...(seed.services ?? [])].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
  const supports = [...(seed.supports ?? [])];
  const impactCalls: SetIncidentImpactInput[] = [];
  const timeline = new Map(Object.entries(seed.timeline ?? {}));
  const stats = new Map(Object.entries(seed.stats ?? {}));
  const health = (service: FakeBusinessService) =>
    fakeHealth(service.id, {
      memberCount: service.memberCount,
      ...(service.status ? { status: service.status } : {}),
      ...service.health,
    });
  const item = (service: FakeBusinessService): BusinessServiceListItem => ({
    id: service.id,
    name: service.name,
    description: service.description ?? null,
    criticality: service.criticality,
    ownerTeam: service.ownerTeam,
    memberCount: service.memberCount,
    health: health(service),
  });

  const engine: BusinessServiceEngine = {
    async getBusinessServiceHealth(ids) {
      const wanted = new Set(ids);
      return new Map(services.filter(s => wanted.has(s.id)).map(s => [s.id, health(s)]));
    },
    async listBusinessServices({ filter = {}, cursor = null, limit = 50 }) {
      const query = filter.query?.trim().toLowerCase();
      const matching = services
        .map(item)
        .filter(
          row =>
            (!query || row.name.toLowerCase().includes(query)) &&
            (!filter.status?.length || filter.status.includes(row.health.status)) &&
            (!filter.criticality?.length ||
              (row.criticality !== null && filter.criticality.includes(row.criticality))) &&
            (!filter.ownerTeamId || row.ownerTeam?.id === filter.ownerTeamId) &&
            (!filter.impactedOnly || row.health.status !== 'OPERATIONAL')
        );
      const start = cursor ? matching.findIndex(row => row.id === cursor) + 1 : 0;
      const items = matching.slice(start, start + limit);
      const hasMore = start + limit < matching.length;
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    },
    async getImpactTimeline(id, window) {
      return (timeline.get(id) ?? []).filter(
        entry =>
          entry.startedAt < window.to && (entry.endedAt === null || entry.endedAt > window.from)
      );
    },
    async getBusinessServiceStats(id, window) {
      return {
        window,
        impactMinutes: 0,
        uptimePercent: 100,
        incidentCount: 0,
        mttaMinutes: null,
        mttrMinutes: null,
        ...stats.get(id),
      };
    },
    async setIncidentImpact(input) {
      impactCalls.push(input);
    },
    async wouldCreateSupportCycle(parentId, childId) {
      // Cycle iff the parent is already reachable downward from the child.
      const seen = new Set<string>();
      const stack = [childId];
      while (stack.length) {
        const current = stack.pop()!;
        if (current === parentId) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const [parent, child] of supports) if (parent === current) stack.push(child);
      }
      return false;
    },
  };
  return { engine, impactCalls, supports };
}
