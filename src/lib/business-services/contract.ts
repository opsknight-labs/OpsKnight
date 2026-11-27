/**
 * Business-service read model and impact contract. Every phase codes against these types and
 * functions; `health-impl.ts` provides the engine and `__fixtures__/health.ts` a fake for tests.
 * All reads are filtered to what `actor` may see.
 */
import type {
  BusinessServiceImpactSource,
  BusinessServiceTier,
  IncidentUrgency,
} from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { PublicServiceStatus } from '@/lib/status-pages/public-contract';
import type { CatalogNeed } from './scorecard';
import * as impl from './health-impl';

/** One status vocabulary everywhere: catalog, dashboard, overview and public status pages. */
export type BsStatus = PublicServiceStatus;
export type BsCriticality = BusinessServiceTier;
export type ImpactSource = BusinessServiceImpactSource;

/** Why a business service has its status. The worst reason wins. */
export type ImpactReason =
  | {
      kind: 'DIRECT';
      status: BsStatus;
      incidentId: string;
      serviceId: string;
      urgency: IncidentUrgency;
    }
  | {
      /** A critical member depends (depth <= 3) on a service with an impacting incident. */
      kind: 'DEPENDENCY';
      status: BsStatus;
      incidentId: string;
      serviceId: string;
      viaServiceId: string;
      depth: number;
    }
  | {
      /** A supporting (child) business service is impacted. */
      kind: 'NESTED';
      status: BsStatus;
      childBusinessServiceId: string;
      depth: number;
      /** The child's worst incident that is not unmarked for this (parent) business service. */
      incidentId: string;
    }
  | { kind: 'MANUAL'; status: BsStatus; incidentId: string; markedById: string | null }
  | { kind: 'MAINTENANCE'; status: 'MAINTENANCE'; maintenanceWindowId: string }
  | {
      /** Customer reports in the service's window reached its threshold; lifts to DEGRADED at most. */
      kind: 'CUSTOMER_REPORTS';
      status: 'DEGRADED';
      reportCount: number;
      threshold: number;
      windowMinutes: number;
    };

export type BusinessServiceHealth = {
  businessServiceId: string;
  status: BsStatus;
  /** When the current status began; null when unknown. */
  since: Date | null;
  reasons: ImpactReason[];
  openIncidentCount: number;
  memberCount: number;
  impactedMemberCount: number;
  computedAt: Date;
  /** Why the status is UNKNOWN, when it is. */
  unknownReason?: 'NO_MEMBERS';
};

export type BusinessServiceListFilter = {
  query?: string;
  status?: readonly BsStatus[];
  criticality?: readonly BsCriticality[];
  ownerTeamId?: string;
  impactedOnly?: boolean;
  /** Scorecard gap: attention (any basic missing), no-owner, no-tier or no-members. */
  needs?: CatalogNeed;
  /** Custom attribute equals a value ("true"/"false" and numbers also match their typed form). */
  attribute?: { key: string; value: string };
};

/**
 * Derived sorts run in memory over the matching set, against the health snapshot: `health` is worst
 * first by default, then tier and name; `budget` is least error budget left first (no SLO last).
 */
export type BusinessServiceDerivedSort = 'health' | 'tier' | 'owner' | 'incidents' | 'budget';

export type BusinessServiceListParams = {
  filter?: BusinessServiceListFilter;
  /** name (default) or newest first, or a derived sort. */
  sort?: 'name' | 'newest' | BusinessServiceDerivedSort;
  /** Direction of a derived sort; each has its own natural default (health: desc, others: asc). */
  direction?: 'asc' | 'desc';
  /** Opaque keyset cursor from the previous page. */
  cursor?: string | null;
  limit?: number;
};

export type BusinessServiceListItem = {
  id: string;
  name: string;
  description: string | null;
  criticality: BsCriticality | null;
  ownerTeam: { id: string; name: string } | null;
  memberCount: number;
  health: BusinessServiceHealth;
};

export type BusinessServiceListPage = {
  items: BusinessServiceListItem[];
  nextCursor: string | null;
};

export type TimeWindow = { from: Date; to: Date };

/** One impact interval. Incident fields are null when the reader cannot see that incident. */
export type ImpactTimelineEntry = {
  incidentId: string | null;
  incidentTitle: string | null;
  urgency: IncidentUrgency | null;
  source: ImpactSource;
  excluded: boolean;
  startedAt: Date;
  /** Null while the impact is still open. */
  endedAt: Date | null;
};

export type BusinessServiceStats = {
  window: TimeWindow;
  /** Union of non-excluded impact intervals, so overlapping incidents are not double counted. */
  impactMinutes: number;
  uptimePercent: number;
  /** Severity-weighted (DEGRADED 25%, PARTIAL 50%, MAJOR 100%) and excluding planned maintenance. */
  weightedUptimePercent?: number;
  weightedDowntimeMinutes?: number;
  /** Window length minus planned maintenance: the denominator of the weighted uptime. */
  weightedWindowMinutes?: number;
  incidentCount: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
};

export type SetIncidentImpactInput = {
  incidentId: string;
  businessServiceId: string;
  /** true marks the incident as impacting (MANUAL); false excludes it and keeps the exclusion. */
  impacted: boolean;
};

export interface BusinessServiceEngine {
  /** Health for the given business services the actor can see; unknown ids are omitted. */
  getBusinessServiceHealth(
    ids: readonly string[],
    actor: AuthorizationActor
  ): Promise<Map<string, BusinessServiceHealth>>;
  listBusinessServices(
    params: BusinessServiceListParams,
    actor: AuthorizationActor
  ): Promise<BusinessServiceListPage>;
  getImpactTimeline(
    businessServiceId: string,
    window: TimeWindow,
    actor: AuthorizationActor
  ): Promise<ImpactTimelineEntry[]>;
  getBusinessServiceStats(
    businessServiceId: string,
    window: TimeWindow,
    actor: AuthorizationActor
  ): Promise<BusinessServiceStats>;
  setIncidentImpact(input: SetIncidentImpactInput, actor: AuthorizationActor): Promise<void>;
  /** Whether making `childId` support `parentId` would close a cycle (or is a self-edge). */
  wouldCreateSupportCycle(parentId: string, childId: string): Promise<boolean>;
}

export const getBusinessServiceHealth: BusinessServiceEngine['getBusinessServiceHealth'] = (
  ids,
  actor
) => impl.engine.getBusinessServiceHealth(ids, actor);
export const listBusinessServices: BusinessServiceEngine['listBusinessServices'] = (
  params,
  actor
) => impl.engine.listBusinessServices(params, actor);
export const getImpactTimeline: BusinessServiceEngine['getImpactTimeline'] = (id, window, actor) =>
  impl.engine.getImpactTimeline(id, window, actor);
export const getBusinessServiceStats: BusinessServiceEngine['getBusinessServiceStats'] = (
  id,
  window,
  actor
) => impl.engine.getBusinessServiceStats(id, window, actor);
export const setIncidentImpact: BusinessServiceEngine['setIncidentImpact'] = (input, actor) =>
  impl.engine.setIncidentImpact(input, actor);
export const wouldCreateSupportCycle: BusinessServiceEngine['wouldCreateSupportCycle'] = (
  parentId,
  childId
) => impl.engine.wouldCreateSupportCycle(parentId, childId);
