'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { CAPABILITIES } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { reviewDependency } from '@/lib/intelligence/dependencies/service';

export type DependencyReviewState = { message: string; ok: boolean } | null;

const inputSchema = z
  .object({
    serviceId: z.string().trim().min(1).max(64),
    dependencyId: z.string().trim().min(1).max(64),
    decision: z.enum(['APPROVE', 'REJECT']),
  })
  .strict();

/**
 * Approves or rejects an observed-dependency suggestion from the service page. Requires
 * INTELLIGENCE_MANAGE, and the suggestion must touch the service being viewed and connect two services
 * the caller may read; the review itself (state change and audit) is the existing `reviewDependency`.
 */
export async function reviewServiceDependencyAction(
  _state: DependencyReviewState,
  form: FormData
): Promise<DependencyReviewState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const parsed = inputSchema.safeParse({
      serviceId: form.get('serviceId'),
      dependencyId: form.get('dependencyId'),
      decision: form.get('decision'),
    });
    if (!parsed.success) return { message: 'Choose approve or reject.', ok: false };
    const { serviceId, dependencyId, decision } = parsed.data;
    const actor = await getCurrentAuthorizationActor();
    const readable = serviceReadWhere(actor);
    const edge = await prisma.serviceDependency.findFirst({
      where: {
        id: dependencyId,
        status: 'SUGGESTED',
        OR: [{ upstreamServiceId: serviceId }, { downstreamServiceId: serviceId }],
        upstream: readable,
        downstream: readable,
      },
      select: { id: true },
    });
    if (!edge) return { message: 'That suggestion no longer exists.', ok: false };
    const result = await reviewDependency(edge.id, decision, { actorId: user.id, source: 'UI' });
    revalidatePath(`/services/${serviceId}`);
    if (result !== 'updated') return { message: 'That suggestion no longer exists.', ok: false };
    return {
      message: decision === 'APPROVE' ? 'Dependency approved.' : 'Suggestion rejected.',
      ok: true,
    };
  } catch (error) {
    if (error instanceof AppError) return { message: error.userMessage, ok: false };
    logger.error('[Intelligence] Service dependency review failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: 'Unable to save. Refresh and try again.', ok: false };
  }
}
