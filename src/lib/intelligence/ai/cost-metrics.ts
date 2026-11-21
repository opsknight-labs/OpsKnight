import 'server-only';
import { logger } from '@/lib/logger';
import { withDbBudget } from '../jobs/db-budget';
import { getAiSettings } from './settings';
import { budgetMetricSamples, getBudgetStatuses, type BudgetMetricSample } from './cost';
import { utcDay } from './budget';

const PROBE_BUDGET = { maxDbMs: 750 };

/**
 * Budget utilisation snapshot for the scrape: per-scope maxima and threshold counts (alerts fire at 80% and
 * 100%), plus today's dollar spend. Best effort: a failing probe returns no samples and never fails a scrape.
 */
export async function collectCostMetrics(now: Date = new Date()): Promise<BudgetMetricSample[]> {
  try {
    const settings = await getAiSettings();
    return await withDbBudget(PROBE_BUDGET, async tx => {
      const statuses = await getBudgetStatuses(settings.dailyTokenBudget, now, tx);
      const today = await tx.aiUsageDay.findUnique({
        where: { day: utcDay(now) },
        select: { costMicros: true },
      });
      return budgetMetricSamples(statuses, Number(today?.costMicros ?? 0));
    });
  } catch {
    logger.debug('[Intelligence] Feature metrics probe unavailable', { probe: 'ai-cost' });
    return [];
  }
}
