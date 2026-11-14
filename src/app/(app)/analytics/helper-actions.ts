'use server';

import * as z from 'zod/v3';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CHANGE_METRICS } from '@/lib/intelligence/helpers/metric-change';
import {
  explainMetricChangeFor,
  METRIC_CHANGE_MAX_WINDOW_DAYS,
  type MetricChangeDetail,
} from '@/lib/intelligence/helpers/metric-change-loader';

const inputSchema = z.object({
  metric: z.enum(CHANGE_METRICS),
  windowDays: z.number().int().min(1).max(METRIC_CHANGE_MAX_WINDOW_DAYS),
  teamId: z.string().min(1).max(64).optional(),
});

/**
 * The expanded "why did this change" for one analytics card, recomputed for the signed-in viewer. A helper,
 * never a gate: invalid input, a denied reader or any failure answer null and the card stays as it was.
 */
export async function explainMetricChangeAction(
  input: unknown
): Promise<MetricChangeDetail | null> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    const { metric, ...options } = parsed.data;
    return await explainMetricChangeFor(await getCurrentAuthorizationActor(), metric, options);
  } catch {
    return null;
  }
}
