import 'server-only';

import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getRetentionPolicy } from '@/lib/retention-policy';
import { cached } from './cache';
import { analyticsParamsKey, type AnalyticsParams } from './params';
import {
  queryFollowThrough,
  queryKpis,
  queryNoise,
  queryResponders,
  queryServices,
  queryTiming,
  queryTrend,
} from './queries';
import { buildAnalyticsScope, type AnalyticsScope } from './scope';
import { resolveAnalyticsWindow, type AnalyticsWindow } from './window';

export * from './params';
export * from './definitions';
export type { AnalyticsWindow } from './window';
export type * from './queries';

const SECTIONS = {
  kpis: queryKpis,
  trend: queryTrend,
  services: queryServices,
  responders: queryResponders,
  timing: queryTiming,
  noise: queryNoise,
  followThrough: queryFollowThrough,
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
    params,
    scope,
    window,
    cacheKey: `${scope.key}|${analyticsParamsKey(params)}|${window.timeZone}`,
  };
}

/** The only way UI and export read analytics: scoped, cached, one section at a time. */
export function getAnalyticsSection<K extends AnalyticsSectionKey>(
  context: AnalyticsContext,
  section: K
): Promise<AnalyticsSectionData<K>> {
  const query = SECTIONS[section] as (
    scope: AnalyticsScope,
    window: AnalyticsWindow
  ) => Promise<AnalyticsSectionData<K>>;
  return cached(`${section}|${context.cacheKey}`, () => query(context.scope, context.window));
}
