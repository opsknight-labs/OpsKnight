'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import type { OpsInsightDecision, OpsInsightStatus } from '@/lib/intelligence/ops-insights/contract';
import { decideInsight } from '@/lib/intelligence/ops-insights/decisions';

export type InsightDecisionState = {
  ok: boolean;
  message: string;
  status: OpsInsightStatus | null;
};

/**
 * Accept, dismiss or reopen one operations insight. The domain service checks the capability, that the
 * viewer can see the insight's scope, and the rate limit, and writes the audit entry.
 */
export async function decideInsightAction(
  id: string,
  decision: OpsInsightDecision
): Promise<InsightDecisionState> {
  try {
    const actor = await getCurrentAuthorizationActor();
    const result = await decideInsight(actor, { id, decision });
    revalidatePath('/intelligence');
    return {
      ok: true,
      status: result.status,
      message:
        result.status === 'ACCEPTED'
          ? 'Marked as accepted.'
          : result.status === 'DISMISSED'
            ? 'Dismissed.'
            : 'Reopened.',
    };
  } catch (error) {
    if (error instanceof AppError) {
      const message =
        error.code === 'RATE_LIMIT_EXCEEDED'
          ? 'You have made a lot of changes recently. Please try again later.'
          : error.code === 'RESOURCE_NOT_FOUND'
            ? 'That insight is no longer available.'
            : error.userMessage;
      return { ok: false, message, status: null };
    }
    logger.error('[Intelligence] Insight decision failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Unable to save. Refresh and try again.', status: null };
  }
}
