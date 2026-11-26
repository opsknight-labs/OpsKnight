import 'server-only';

import prisma from '@/lib/prisma';
import { getBusinessServiceStats } from '../stats';
import { computeErrorBudget, type ErrorBudget } from '../slo';
import { isFreezeWarningEnabled } from './config';
import { SYSTEM_ACTOR } from './data';
import { evaluateFreeze, type FreezeEvaluation } from './freeze';

const NO_FREEZE: FreezeEvaluation = { warn: false, level: 'none', message: null };
const MAX_SERVICES_PER_CHANGE = 25;

/** The rolling-window error budget of a business service with an SLO (also used by budget alerts). */
export async function errorBudgetFor(
  row: { id: string; sloTarget: number; sloWindowDays: number | null },
  to = new Date()
): Promise<ErrorBudget> {
  const windowDays = row.sloWindowDays ?? 30;
  const from = new Date(to.getTime() - windowDays * 86_400_000);
  const stats = await getBusinessServiceStats(row.id, { from, to }, SYSTEM_ACTOR);
  return computeErrorBudget({
    targetPercent: row.sloTarget,
    windowDays,
    downtimeMinutes: stats.weightedDowntimeMinutes ?? stats.impactMinutes,
    windowMinutes: stats.weightedWindowMinutes,
  });
}

async function evaluateOne(row: {
  id: string;
  sloTarget: number | null;
  sloWindowDays: number | null;
}): Promise<FreezeEvaluation> {
  if (row.sloTarget === null) return NO_FREEZE;
  return evaluateFreeze(await errorBudgetFor({ ...row, sloTarget: row.sloTarget }));
}

/**
 * Freeze warning for one business service. Off unless an admin enabled it, and advisory only:
 * callers show it, nothing is blocked.
 */
export async function freezeForBusinessService(id: string): Promise<FreezeEvaluation> {
  if (!(await isFreezeWarningEnabled())) return NO_FREEZE;
  const row = await prisma.businessService.findUnique({
    where: { id },
    select: { id: true, sloTarget: true, sloWindowDays: true },
  });
  return row ? evaluateOne(row) : NO_FREEZE;
}

/** Business services (with an SLO) containing `serviceId` whose error budget is exhausted. */
export async function exhaustedBudgetsForService(
  serviceId: string
): Promise<Array<{ id: string; name: string }>> {
  if (!(await isFreezeWarningEnabled())) return [];
  const rows = await prisma.businessService.findMany({
    where: {
      lifecycle: { not: 'RETIRED' },
      sloTarget: { not: null },
      members: { some: { serviceId } },
    },
    take: MAX_SERVICES_PER_CHANGE,
    select: { id: true, name: true, sloTarget: true, sloWindowDays: true },
  });
  const results = await Promise.all(
    rows.map(async row => ({ row, freeze: await evaluateOne(row) }))
  );
  return results
    .filter(result => result.freeze.level === 'exhausted')
    .map(({ row }) => ({ id: row.id, name: row.name }));
}
