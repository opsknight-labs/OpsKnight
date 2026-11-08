'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { removeServiceFact } from '@/lib/intelligence/memory/facts';
import {
  updateSquireMemorySettings,
  updateSquireServicePolicy,
} from '@/lib/intelligence/memory/settings';

export type SquireMemoryActionState = { message: string; ok: boolean };

const MEMORY_PATH = '/settings/intelligence/ai/memory';
const servicePath = (serviceId: string) =>
  `/settings/intelligence/services/${encodeURIComponent(serviceId)}/squire`;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

function failure(error: unknown): SquireMemoryActionState {
  if (error instanceof AppError) {
    return {
      message:
        error.code === 'PRECONDITION_FAILED'
          ? 'This setting changed since you opened the page. Refresh and try again.'
          : error.userMessage,
      ok: false,
    };
  }
  logger.error('[Squire] Memory settings action failed', {
    error: error instanceof Error ? error.name : 'error',
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

/** The global knowledge-index switch. Off by default; audited; compare-and-set on the revision. */
export async function saveSquireMemorySettingsAction(
  _state: SquireMemoryActionState,
  form: FormData
): Promise<SquireMemoryActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const next = await updateSquireMemorySettings(
      {
        knowledgeEnabled: form.get('knowledgeEnabled') === 'on',
        expectedRevision: Number(text(form, 'expectedRevision')),
      },
      user.id
    );
    revalidatePath(MEMORY_PATH);
    return {
      message: next.knowledgeEnabled
        ? 'Knowledge index turned on. The intelligence lane fills it in the background.'
        : 'Knowledge index turned off. Derived knowledge is removed by the next retention sweeps.',
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

/** One service's proactive switches. Every switch defaults off; audited; compare-and-set on the revision. */
export async function saveSquireServicePolicyAction(
  _state: SquireMemoryActionState,
  form: FormData
): Promise<SquireMemoryActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const serviceId = text(form, 'serviceId');
    if (!serviceId) return { message: 'Choose a service.', ok: false };
    const nudge = text(form, 'nudgeAfterMinutes').trim();
    await updateSquireServicePolicy(
      serviceId,
      {
        briefingEnabled: form.get('briefingEnabled') === 'on',
        postmortemDraftEnabled: form.get('postmortemDraftEnabled') === 'on',
        nudgeAfterMinutes:
          form.get('nudgeEnabled') === 'on' && nudge ? Math.trunc(Number(nudge)) : null,
        expectedRevision: Number(text(form, 'expectedRevision')),
      },
      user.id
    );
    revalidatePath(servicePath(serviceId));
    return { message: 'Proactive Squire settings saved.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Removes one learned fact. Allowed to people who may curate the service's knowledge. */
export async function removeServiceFactAction(
  _state: SquireMemoryActionState,
  form: FormData
): Promise<SquireMemoryActionState> {
  try {
    const actor = await getCurrentAuthorizationActor();
    const serviceId = text(form, 'serviceId');
    const removed = await removeServiceFact(actor, { serviceId, factId: text(form, 'factId') });
    revalidatePath(servicePath(serviceId));
    return removed
      ? { message: 'Fact removed.', ok: true }
      : { message: 'That fact was already removed.', ok: false };
  } catch (error) {
    return failure(error);
  }
}
