import type { BusinessServiceTier } from '@prisma/client';
import type {
  BsStatus,
  BusinessServiceHealth,
  BusinessServiceListFilter,
} from '@/lib/business-services/contract';
import {
  CATALOG_NEEDS,
  matchesNeed,
  scoreBusinessService,
  type CatalogNeed,
} from '@/lib/business-services/scorecard';
import { PUBLIC_SERVICE_STATUSES } from '@/lib/status-pages/public-contract';

/** URL query of the catalog. `c` is the stack of keyset cursors that led to the current page. */
export type CatalogSearchParams = Record<string, string | string[] | undefined>;

export type CatalogQuery = {
  q: string;
  tier: BusinessServiceTier | '';
  /** A status, or "impacted" for anything degraded or worse. */
  status: BsStatus | 'impacted' | '';
  team: string;
  /** Scorecard gap filter. */
  needs: CatalogNeed | '';
};

const TIERS: readonly BusinessServiceTier[] = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'];
const IMPACTED: ReadonlySet<BsStatus> = new Set(['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE']);
/** Deep enough for 5,000 business services at the page size; longer stacks are cut. */
const MAX_CURSORS = 200;

export const isImpacted = (status: BsStatus) => IMPACTED.has(status);

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

export function parseCatalogParams(params: CatalogSearchParams = {}) {
  const tier = first(params.tier);
  const status = first(params.status);
  const needs = first(params.needs);
  const query: CatalogQuery = {
    q: first(params.q).slice(0, 100),
    tier: (TIERS as readonly string[]).includes(tier) ? (tier as BusinessServiceTier) : '',
    status:
      status === 'impacted' || (PUBLIC_SERVICE_STATUSES as readonly string[]).includes(status)
        ? (status as CatalogQuery['status'])
        : '',
    team: first(params.team).slice(0, 100),
    needs: (CATALOG_NEEDS as readonly string[]).includes(needs) ? (needs as CatalogNeed) : '',
  };
  const raw = params.c;
  const cursors = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .filter(Boolean)
    .slice(0, MAX_CURSORS);
  return { query, cursors, filter: toListFilter(query) };
}

export function toListFilter(query: CatalogQuery): BusinessServiceListFilter {
  return {
    ...(query.q ? { query: query.q } : {}),
    ...(query.tier ? { criticality: [query.tier] } : {}),
    ...(query.status === 'impacted'
      ? { status: [...IMPACTED] }
      : query.status
        ? { status: [query.status] }
        : {}),
    ...(query.team ? { ownerTeamId: query.team } : {}),
    ...(query.needs ? { needs: query.needs } : {}),
  };
}

export const hasActiveFilters = (query: CatalogQuery) =>
  Boolean(query.q || query.tier || query.status || query.team || query.needs);

/** Catalog URL for a query and cursor stack; empty values stay out of the URL. */
export function catalogHref(query: CatalogQuery, cursors: readonly string[] = []) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
  for (const cursor of cursors) search.append('c', cursor);
  const text = search.toString();
  return text ? `/services/business?${text}` : '/services/business';
}

/** Only the owner, tier and member checks matter to the catalog filters. */
export const scoreRow = (
  row: Pick<CountRow, 'ownerTeamId' | 'ownerUserId' | 'criticality' | 'memberCount'>
) => scoreBusinessService({ ...row, linkCount: 0, description: null });

type CountRow = {
  id: string;
  name: string;
  description: string | null;
  criticality: BusinessServiceTier | null;
  ownerTeamId: string | null;
  ownerUserId: string | null;
  memberCount: number;
};

/**
 * How many visible business services match the filter, for the pagination footer.
 * shortcut: listBusinessServices returns no total, so this mirrors its matching (name or description
 * contains the query, case-insensitive; tier; owner team; status). Switch to an engine count when the
 * contract gains one.
 */
export function countMatching(
  rows: readonly CountRow[],
  health: ReadonlyMap<string, BusinessServiceHealth>,
  query: CatalogQuery
): number {
  const needle = query.q.toLowerCase();
  return rows.filter(row => {
    const status = health.get(row.id)?.status;
    if (!status) return false;
    if (
      needle &&
      !row.name.toLowerCase().includes(needle) &&
      !row.description?.toLowerCase().includes(needle)
    )
      return false;
    if (query.tier && row.criticality !== query.tier) return false;
    if (query.team && row.ownerTeamId !== query.team) return false;
    if (query.needs && !matchesNeed(scoreRow(row), query.needs)) return false;
    if (query.status === 'impacted') return isImpacted(status);
    return !query.status || status === query.status;
  }).length;
}
