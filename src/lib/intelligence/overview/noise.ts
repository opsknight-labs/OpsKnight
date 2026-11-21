import 'server-only';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import { getNoiseControlKpis } from '../noise-controls/kpis';
import { OVERVIEW_SECTION_BUDGET, serviceIdFilter, type OverviewScope } from './scope';
import type { OverviewWindow } from './window';

const MAX_SOURCES = 8;

export interface OverviewNoiseSource {
  key: string;
  label: string;
  control: 'MAINTENANCE' | 'SUPPRESSION';
  count: number;
}

export interface OverviewNoise {
  /** Policies in each mode across the workspace; all OFF means noise controls were never turned on. */
  modes: { on: number; shadow: number };
  alerts: number;
  incidents: number;
  compressionRatio: number;
  /** Applied (ON) decisions only. SHADOW decisions are never counted here. */
  pagesAvoided: number;
  /** SHADOW decisions: what turning the controls on would have avoided. */
  shadowWouldAvoid: number;
  downgraded: number;
  grouped: number;
  ungrouped: number;
  falseGroupRate: number;
  /** Applied suppression by rule or maintenance window, largest first. */
  suppressedBySource: OverviewNoiseSource[];
  heartbeats: { monitors: number; missing: number; late: number };
}

/**
 * Noise for the window: reuses the noise-controls KPIs (restricted to the readable services) and adds the
 * applied suppression volume per rule and maintenance window. Index-backed on
 * PrePagingDecision(control, mode, createdAt) and bounded to the top sources.
 */
export async function getOverviewNoise(
  scope: OverviewScope,
  window: OverviewWindow,
  client: typeof prisma = prisma
): Promise<OverviewNoise> {
  if (scope.serviceIds !== null && scope.serviceIds.length === 0)
    return {
      modes: { on: 0, shadow: 0 },
      alerts: 0,
      incidents: 0,
      compressionRatio: 1,
      pagesAvoided: 0,
      shadowWouldAvoid: 0,
      downgraded: 0,
      grouped: 0,
      ungrouped: 0,
      falseGroupRate: 0,
      suppressedBySource: [],
      heartbeats: { monitors: 0, missing: 0, late: 0 },
    };
  return withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    async tx => {
      const [kpis, modes, sources] = await Promise.all([
        getNoiseControlKpis(
          { days: window.days, serviceIds: scope.serviceIds, now: window.until },
          tx
        ),
        tx.noiseControlPolicy.groupBy({
          by: ['mode'],
          where: { mode: { in: ['ON', 'SHADOW'] } },
          _count: { _all: true },
        }),
        tx.prePagingDecision.groupBy({
          by: ['control', 'sourceId', 'sourceName'],
          where: {
            ...serviceIdFilter(scope),
            control: { in: ['MAINTENANCE', 'SUPPRESSION'] },
            mode: 'ON',
            applied: true,
            createdAt: { gte: window.since, lt: window.until },
          },
          _count: { _all: true },
          orderBy: { _count: { id: 'desc' } },
          take: MAX_SOURCES,
        }),
      ]);
      const modeCount = (mode: string) => modes.find(row => row.mode === mode)?._count._all ?? 0;
      return {
        modes: { on: modeCount('ON'), shadow: modeCount('SHADOW') },
        alerts: kpis.alerts,
        incidents: kpis.incidents,
        compressionRatio: kpis.compressionRatio,
        pagesAvoided: kpis.pagesAvoided,
        shadowWouldAvoid: kpis.shadowWouldAvoid,
        downgraded: kpis.downgraded,
        grouped: kpis.grouped,
        ungrouped: kpis.ungrouped,
        falseGroupRate: kpis.falseGroupRate,
        suppressedBySource: sources.map(row => ({
          key: `${row.control}:${row.sourceId ?? 'none'}`,
          label:
            row.sourceName ??
            (row.control === 'MAINTENANCE' ? 'Maintenance window' : 'Suppression rule'),
          control: row.control as 'MAINTENANCE' | 'SUPPRESSION',
          count: row._count._all,
        })),
        heartbeats: kpis.heartbeats,
      };
    },
    client
  );
}
