'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod/v3';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { saveScorecardRubric } from '@/lib/business-services/scorecard-config';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/** Saves the scorecard rubric from the settings editor (JSON text). Admins only; validated and audited. */
export async function saveScorecardRubricAction(text: string) {
  await assertAdmin();
  const user = await getCurrentUser();
  let input: unknown;
  try {
    input = JSON.parse(String(text).slice(0, 100_000));
  } catch {
    return { success: false as const, error: 'The rubric is not valid JSON.' };
  }
  try {
    await saveScorecardRubric(input, { id: user.id, source: 'UI' });
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return {
        success: false as const,
        error: issue
          ? `${issue.path.join('.') || 'rubric'}: ${issue.message}`
          : 'Check the rubric.',
      };
    }
    if (error instanceof AppError) return { success: false as const, error: error.userMessage };
    logger.error('Scorecard rubric save failed', { component: 'scorecard-actions', error });
    return { success: false as const, error: 'Something went wrong. Try again.' };
  }
  revalidatePath('/settings/notifications');
  return { success: true as const };
}
