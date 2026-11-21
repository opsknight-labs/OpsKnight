import 'server-only';

import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getRetentionPolicy } from '@/lib/retention-policy';
import { cachedWithTime, invalidateCached, type Cached } from './cache';
import { analyticsParamsKey, type AnalyticsParams } from './params';
import { queryAvailability } from './queries-availability';
import {
  queryFollowThrough,
  queryInterruptions,
  queryKpis,
  queryNoise,
  queryResponders,
  queryServices,
  queryTiming,
  queryTrend,
} from './queries';
import { queryBreakdown } from './queries-breakdown';
import { buildAnalyticsScope, type AnalyticsScope } from './scope';
import { resolveAnalyticsWindow, type AnalyticsWindow } from './window';

export * from './params';
export * from './definitions';
export type { AnalyticsWindow } from './window';
export type * from './queries';
export type * from './queries-availability';
export type * from './queries-breakdown';

const SECTIONS = {
  kpis: queryKpis,
  trend: queryTrend,
  services: queryServices,
  responders: queryResponders,
  interruptions: queryInterruptions,
  availability: queryAvailability,
  timing: queryTiming,
  noise: queryNoise,
  followThrough: queryFollowThrough,
  breakdownTeam: (scope: AnalyticsScope, window: AnalyticsWindow) =>
    queryBreakdown(scope, window, 'team'),
  breakdownPriority: (scope: AnalyticsScope, window: AnalyticsWindow) =>
    queryBreakdown(scope, window, 'priority'),
  breakdownUrgency: (scope: AnalyticsScope, window: AnalyticsWindow) =>
    queryBreakdown(scope, window, 'urgency'),
};

export type AnalyticsSectionKey = keyof typeof SECTIONS;
export type AnalyticsSectionData<K extends AnalyticsSectionKey> = Awaited<
  ReturnType<(typeof SECTIONS)[K]>
>;

/** Everything a section needs, resolved once per request. */
export type AnalyticsContext = {
  params: AnalyticsParams;
  scope: AnalyticsScope;
  window: AnalyticsWindow;
  cacheKey: string;
};

export async function createAnalyticsContext(
  actor: AuthorizationActor,
  params: AnalyticsParams,
  userTimeZone?: string | null
): Promise<AnalyticsContext> {
  const scope = buildAnalyticsScope(actor, params);
  const window = resolveAnalyticsWindow({
    params,
    policy: await getRetentionPolicy(),
    userTimeZone,
  });
  return {
    // No comparison when the previous period would fall outside retention. The cache key
    // keeps the requested params (the override follows from them) so Refresh still matches.
    params: window.hasPrevious ? params : { ...params, compare: false },
    scope,
    window,
    cacheKey: `${filterCacheKey(scope, params)}${window.timeZone}`,
  };
}

// `|scope|filters|` identifies one actor's view of one filter set, in any timezone.
const filterCacheKey = (scope: AnalyticsScope, params: AnalyticsParams) =>
  `|${scope.key}|${analyticsParamsKey(params)}|`;

/** The only way UI and export read analytics: scoped, cached, one section at a time. */
export async function getAnalyticsSection<K extends AnalyticsSectionKey>(
  context: AnalyticsContext,
  section: K
): Promise<AnalyticsSectionData<K>> {
  return (await getAnalyticsSectionWithTime(context, section)).value;
}

/** Same as getAnalyticsSection, plus `asOf`: when the numbers were computed. */
export function getAnalyticsSectionWithTime<K extends AnalyticsSectionKey>(
  context: AnalyticsContext,
  section: K
): Promise<Cached<AnalyticsSectionData<K>>> {
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
  const query = SECTIONS[section] as unknown as (
    scope: AnalyticsScope,
    window: AnalyticsWindow,
    params: AnalyticsParams
  ) => Promise<AnalyticsSectionData<K>>;
  // cacheKey includes every param, so sections that read params (trend: compare) stay distinct.
  return cachedWithTime(`${section}${context.cacheKey}`, () =>
    query(context.scope, context.window, context.params)
  );
}

/** Forces fresh numbers for this actor and filter set on the next read. */
export function invalidateAnalyticsCache(
  actor: AuthorizationActor,
  params: AnalyticsParams
): number {
  return invalidateCached(filterCacheKey(buildAnalyticsScope(actor, params), params));
}
