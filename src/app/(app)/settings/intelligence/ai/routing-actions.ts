'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { updateAiRouting } from '@/lib/intelligence/ai/routing-settings';
import { routingFromForm } from '@/lib/intelligence/ai/routing';

export type AiRoutingActionState = { message: string; ok: boolean };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** Administrators turn on investigation mode and route capabilities to a preferred provider and model. */
export async function saveAiRoutingAction(
  _state: AiRoutingActionState,
  form: FormData
): Promise<AiRoutingActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    await updateAiRouting(
      {
        squireInvestigationEnabled: form.get('squireInvestigationEnabled') === 'on',
        capabilityRouting: routingFromForm(form),
        expectedRevision: Number(text(form, 'expectedRevision')),
      },
      { actorId: actor.id, source: 'UI' }
    );
    invalidateGatewayCache();
    revalidatePath('/settings/intelligence/ai');
    return { message: 'Investigation and routing saved.', ok: true };
  } catch (error) {
    if (error instanceof AppError) {
      const detail = error.fields?.[0];
      return {
        message:
          error.code === 'PRECONDITION_FAILED'
            ? 'These settings changed since you opened the page. Refresh and try again.'
            : detail
              ? `${error.userMessage} (${detail.field}: ${detail.message})`
              : error.userMessage,
        ok: false,
      };
    }
    logger.error('[Intelligence] AI routing action failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: 'Unable to save. Refresh and try again.', ok: false };
  }
}
