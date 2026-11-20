'use server';

import * as z from 'zod/v3';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { explainRunbookFailure } from '@/lib/intelligence/helpers/runbook-failure';
import type { OnDemandDetail } from '@/lib/intelligence/helpers/on-demand';

const idSchema = z.string().min(1).max(64);

/**
 * "Explain this failure" on a runbook execution, recomputed for the signed-in viewer. A helper, never a
 * gate: invalid input, a denied reader or any failure answer null.
 */
export async function explainRunbookFailureAction(
  executionId: unknown
): Promise<OnDemandDetail | null> {
  const parsed = idSchema.safeParse(executionId);
  if (!parsed.success) return null;
  try {
    return await explainRunbookFailure(await getCurrentAuthorizationActor(), parsed.data);
  } catch {
    return null;
  }
}
