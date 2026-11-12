'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { OPS_INSIGHT_SWITCHES } from '@/lib/intelligence/ops-insights/contract';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import type { IntelligenceActionState } from './actions';

/** Saves the operations-insight switches; revision-checked and audited by the settings service. */
export async function saveOpsInsightSwitches(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    await updateOpsInsightSwitches(
      {
        ...Object.fromEntries(OPS_INSIGHT_SWITCHES.map(name => [name, form.get(name) === 'on'])),
        expectedRevision: Number(form.get('expectedRevision')),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath('/settings/intelligence');
    return { message: 'Operations insight settings saved.', ok: true };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        ok: false,
        message:
          error.code === 'PRECONDITION_FAILED'
            ? 'These settings changed since you opened the page. Refresh and try again.'
            : error.userMessage,
      };
    }
    logger.error('[Intelligence] Operations insight settings action failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: 'Unable to save. Refresh and try again.', ok: false };
  }
}
