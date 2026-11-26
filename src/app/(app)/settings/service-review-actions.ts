'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { assertAdmin, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { reviewConfigSchema, saveReviewConfig } from '@/lib/business-services/reviews/config';
import { runServiceReviews, sendReviewPreview } from '@/lib/business-services/reviews/run';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

// Expected failures come back as data: a thrown Error's message is redacted in production builds.
// Only validation and domain (AppError) messages reach the browser; anything else (database,
// email provider, infrastructure) is logged here and replaced by a generic line.
const reviewActionMessage = (error: unknown) => {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the settings.';
  if (error instanceof AppError) return error.userMessage;
  logger.error('Service review action failed', { component: 'service-review-actions', error });
  return 'Something went wrong. Try again.';
};
type Failed = { success: false; error: string };

/** Own opt-in to receive the monthly review for services of my teams. Responders and admins only. */
export async function setMyServiceReviews(enabled: boolean) {
  const value = z.boolean().parse(enabled);
  const permissions = await getUserPermissions();
  if (!permissions.isAdmin && !permissions.isResponderOrAbove)
    return {
      success: false,
      error: 'Service reviews are available to responders and administrators.',
    } as Failed;
  const user = await getCurrentUser();
  await prisma.user.update({ where: { id: user.id }, data: { receiveServiceReviews: value } });
  revalidatePath('/settings/profile');
  return { success: true } as const;
}

export async function saveServiceReviewSettings(input: unknown) {
  await assertAdmin();
  const user = await getCurrentUser();
  try {
    await saveReviewConfig(reviewConfigSchema.parse(input), { id: user.id, source: 'UI' });
  } catch (error) {
    return { success: false, error: reviewActionMessage(error) } as Failed;
  }
  revalidatePath('/settings/notifications');
  return { success: true } as const;
}

export async function runServiceReviewsNow() {
  await assertAdmin();
  const user = await getCurrentUser();
  const result = await runServiceReviews({ manual: true, actorId: user.id });
  revalidatePath('/settings/notifications');
  return result;
}

export async function sendServiceReviewPreview() {
  await assertAdmin();
  const user = await getCurrentUser();
  try {
    return { success: true, ...(await sendReviewPreview(user.id)) } as const;
  } catch (error) {
    return { success: false, error: reviewActionMessage(error) } as Failed;
  }
}

/** Admin bulk action: opt every non-retired service of a team in (or out) of the review. */
export async function setTeamServicesInReview(teamId: string, include: boolean) {
  await assertAdmin();
  const user = await getCurrentUser();
  const id = z.string().min(1).max(100).parse(teamId);
  const result = await prisma.businessService.updateMany({
    where: { ownerTeamId: id, lifecycle: { not: 'RETIRED' } },
    data: { includeInReview: z.boolean().parse(include) },
  });
  await emitAuditEvent({
    action: 'business_service_review.team_opt_in',
    source: 'UI',
    actor: { type: 'USER', id: user.id },
    target: { type: 'SYSTEM_CONFIG', id: 'business_service_reviews' },
    metadata: { teamId: id, include, services: result.count },
  });
  revalidatePath('/settings/notifications');
  return { count: result.count };
}
