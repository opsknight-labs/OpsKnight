'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  OPS_INSIGHT_SCOPE_TYPES,
  type OpsInsightDecision,
  type OpsInsightStatus,
} from '@/lib/intelligence/ops-insights/contract';
import { decideInsight } from '@/lib/intelligence/ops-insights/decisions';
import {
  PHRASING_UNAVAILABLE,
  phraseInsightsForScope,
  type InsightPhrasing,
} from '@/lib/intelligence/ops-insights/phrasing';

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

const phraseScopeSchema = z
  .object({ type: z.enum(OPS_INSIGHT_SCOPE_TYPES), id: z.string().min(1).max(64) })
  .strict();

/**
 * Plain-language phrasing of one scope's open insights, asked for when a person expands the panel. The
 * insights are read again under the viewer's own scope; nothing the client sends is phrased.
 */
export async function phraseInsightsAction(scope: unknown): Promise<InsightPhrasing> {
  const parsed = phraseScopeSchema.safeParse(scope);
  if (!parsed.success) return { phrases: {}, notice: PHRASING_UNAVAILABLE };
  try {
    return await phraseInsightsForScope(await getCurrentAuthorizationActor(), parsed.data);
  } catch (error) {
    logger.warn('[Intelligence] Insight phrasing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { phrases: {}, notice: PHRASING_UNAVAILABLE };
  }
}
