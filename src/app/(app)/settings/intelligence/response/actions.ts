'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { declareDependency, removeDependency, reviewDependency } from '@/lib/intelligence/dependencies/service';

export type DependencyActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/response';

function failure(error: unknown): DependencyActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    return { message: detail ? `${error.userMessage} (${detail.message})` : error.userMessage, ok: false };
  }
  logger.error('[Intelligence] Dependency action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export async function declareDependencyAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    await declareDependency(
      { upstreamServiceId: text(form, 'upstreamServiceId'), downstreamServiceId: text(form, 'downstreamServiceId') },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return { message: 'Dependency saved.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function reviewDependencyAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const decision = text(form, 'decision');
    if (decision !== 'APPROVE' && decision !== 'REJECT') return { message: 'Choose approve or reject.', ok: false };
    const result = await reviewDependency(text(form, 'id'), decision, { actorId: actor.id, source: 'UI' });
    revalidatePath(PATH);
    return result === 'updated'
      ? { message: decision === 'APPROVE' ? 'Dependency approved.' : 'Suggestion rejected.', ok: true }
      : { message: 'That suggestion no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function removeDependencyAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await removeDependency(text(form, 'id'), { actorId: actor.id, source: 'UI' });
    revalidatePath(PATH);
    return result === 'removed'
      ? { message: 'Dependency removed.', ok: true }
      : { message: 'That dependency no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}
