'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { INTELLIGENCE_MODES, type IntelligenceModeValue, type PolicyDefinition } from '@/lib/intelligence/contract';
import { clearServiceOverride, publishPolicyVersion, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';

export type ServicePolicyActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/services';

function failure(error: unknown): ServicePolicyActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    const message =
      error.code === 'PRECONDITION_FAILED'
        ? 'This policy changed since you opened the page. Refresh and try again.'
        : detail
          ? `${error.userMessage} (${detail.field}: ${detail.message})`
          : error.userMessage;
    return { message, ok: false };
  }
  logger.error('[Intelligence] Service policy action failed', { error: error instanceof Error ? error.message : String(error) });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Publishes the service's own policy, starting from whatever currently applies to it. */
export async function saveServicePolicyAction(
  _state: ServicePolicyActionState,
  form: FormData
): Promise<ServicePolicyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const serviceId = text(form, 'serviceId');
    const mode = text(form, 'mode') as IntelligenceModeValue;
    if (!serviceId) return { message: 'Choose a service.', ok: false };
    if (!INTELLIGENCE_MODES.includes(mode)) return { message: 'Choose a valid mode.', ok: false };
    const current = await resolveEffectivePolicy(serviceId);
    const definition: PolicyDefinition = {
      ...current.definition,
      similarity: { enabled: form.get('similarityEnabled') === 'on', minScore: current.definition.similarity.minScore },
      response: { enabled: form.get('responseEnabled') === 'on' },
    };
    const result = await publishPolicyVersion(
      { serviceId },
      {
        mode,
        definition,
        reason: text(form, 'reason') || 'Service policy override',
        expectedHeadVersion: Number(text(form, 'expectedHeadVersion')),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return { message: `Service policy version ${result.version} published.`, ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function clearServiceOverrideAction(
  _state: ServicePolicyActionState,
  form: FormData
): Promise<ServicePolicyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await clearServiceOverride(text(form, 'serviceId'), { actorId: actor.id, source: 'UI' });
    revalidatePath(PATH);
    return result === 'cleared'
      ? { message: 'This service now follows the global policy.', ok: true }
      : { message: 'This service has no override.', ok: false };
  } catch (error) {
    return failure(error);
  }
}
