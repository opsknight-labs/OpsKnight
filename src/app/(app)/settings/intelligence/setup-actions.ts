'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { applyRecommendedPreset } from '@/lib/intelligence/settings/setup';
import { intelligenceSettingsPath } from '@/lib/intelligence/settings/routes';
import type { IntelligenceActionState } from './actions';

const revision = (form: FormData, name: string) => {
  const value = Number(form.get(name));
  return Number.isInteger(value) && value >= 0 ? value : -1;
};

/** The setup checklist's "Turn on recommended" button: safe switches only, revision-checked and audited. */
export async function applyRecommendedSetup(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const changed = await applyRecommendedPreset(
      {
        settingsRevision: revision(form, 'settingsRevision'),
        policyVersion: revision(form, 'policyVersion'),
        noiseRevision: revision(form, 'noiseRevision'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(intelligenceSettingsPath('engine'));
    revalidatePath(intelligenceSettingsPath('noise'));
    return {
      ok: true,
      message: changed.length > 0 ? 'Recommended settings turned on.' : 'Already set up.',
    };
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
    logger.error('[Intelligence] Recommended setup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: 'Unable to save. Refresh and try again.', ok: false };
  }
}
