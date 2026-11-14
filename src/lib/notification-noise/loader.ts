import 'server-only';

import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import type { OpsInsightView } from '@/lib/intelligence/ops-insights/contract';
import {
  listInsightsForScope,
  readableOpsInsightScopes,
} from '@/lib/intelligence/ops-insights/view';
import { buildNoiseReport, noiseWindow, toNoiseDailyRows, type NoiseReport } from './report';

const MAX_SERVICES = 20;
/** 30 days x 24 hours x 2 (auto-resolved or not) for about seven services before the cap bites. */
const MAX_ROLLUP_ROWS = 10_000;

/** The Notifications area switch of the operations-insight foundation, behind the master switch. */
export async function notificationNoiseEnabled(): Promise<boolean> {
  const settings = await getIntelligenceSettings();
  return settings.opsInsightsEnabled && settings.opsInsightsNotificationsEnabled;
}

export interface NoiseOverview {
  report: NoiseReport;
  insights: OpsInsightView[];
  bundleLowUrgencyPages: boolean;
}

/**
 * Report and stored suggestions for one person, for that person, an owner of one of their teams, or an
 * administrator (the USER insight rule). Null when the area is off or the person does not exist. Reads the
 * daily pages rollup through the subject index; service names resolve under the viewer's own read scope.
 */
export async function loadNoiseOverview(
  viewer: AuthorizationActor,
  userId: string,
  now: Date = new Date()
): Promise<NoiseOverview | null> {
  if (!(await readableOpsInsightScopes(viewer, 'USER', [userId])).has(userId)) {
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
  if (!(await notificationNoiseEnabled())) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { bundleLowUrgencyPages: true },
  });
  if (!user) return null;
  const rows = toNoiseDailyRows(
    await queryOpsRollup(OPS_ROLLUPS.pagesPerUserService, {
      ...noiseWindow(now),
      subjectKey: userId,
      limit: MAX_ROLLUP_ROWS,
    })
  );
  const pagesByService = new Map<string, number>();
  for (const row of rows) {
    pagesByService.set(row.serviceId, (pagesByService.get(row.serviceId) ?? 0) + row.pages);
  }
  const busiest = [...pagesByService.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SERVICES)
    .map(([id]) => id);
  const [names, insights] = await Promise.all([
    readableOpsInsightScopes(viewer, 'SERVICE', busiest),
    listInsightsForScope(viewer, { type: 'USER', id: userId }),
  ]);
  const full = buildNoiseReport(rows, names);
  return {
    report: { ...full, byService: full.byService.slice(0, MAX_SERVICES) },
    insights,
    bundleLowUrgencyPages: user.bundleLowUrgencyPages,
  };
}
